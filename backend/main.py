from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any, Literal, TypedDict
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langchain.prompts import ChatPromptTemplate
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEmbeddings
from langgraph.graph import END, START, StateGraph
from pypdf import PdfReader
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "data"
MAX_HISTORY = 6
SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf"}

app = FastAPI(title="Dynamic Knowledge Retrieval Chatbot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: str | None = None


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    route: str
    retrieved_chunks: list[dict[str, Any]]
    sources: list[str]
    used_context: bool


class UploadResponse(BaseModel):
    uploaded_files: list[str]
    chunks_indexed: int


class SessionMemory(TypedDict):
    messages: list[BaseMessage]


class GraphState(TypedDict):
    question: str
    chat_history: list[BaseMessage]
    route: str
    retrieved_docs: list[Document]
    answer: str


SESSIONS: dict[str, SessionMemory] = {}
INDEX_CACHE: dict[str, Any] = {"documents": [], "vectors": []}


def require_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured. Add it to backend/.env before starting the API.",
        )
    return api_key


def get_llm() -> ChatGoogleGenerativeAI:
    api_key = require_api_key()
    return ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash"),
        temperature=0.2,
        google_api_key=api_key,
    )


def get_embeddings() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=os.getenv(
            "EMBEDDING_MODEL",
            "sentence-transformers/all-MiniLM-L6-v2",
        ),
    )


def load_documents() -> list[Document]:
    documents: list[Document] = []
    if not DOCS_DIR.exists():
        return documents

    for path in sorted(DOCS_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if path.suffix.lower() == ".pdf":
            content = extract_pdf_text(path)
        else:
            content = path.read_text(encoding="utf-8")

        if not content.strip():
            continue

        documents.append(
            Document(
                page_content=content,
                metadata={"source": path.name, "path": str(path)},
            )
        )
    return documents


def extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n".join(pages)


def validate_upload(file: UploadFile) -> str:
    filename = Path(file.filename or "").name
    suffix = Path(filename).suffix.lower()
    if not filename:
        raise HTTPException(status_code=400, detail="Uploaded file is missing a name.")
    if suffix not in SUPPORTED_EXTENSIONS:
        allowed = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type for {filename}. Allowed types: {allowed}.",
        )
    return filename


def build_vectorstore() -> int:
    documents = load_documents()
    if not documents:
        INDEX_CACHE["documents"] = []
        INDEX_CACHE["vectors"] = []
        return 0

    splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)
    chunks = splitter.split_documents(documents)
    vectors = get_embeddings().embed_documents([chunk.page_content for chunk in chunks])
    INDEX_CACHE["documents"] = chunks
    INDEX_CACHE["vectors"] = vectors
    return len(chunks)


def cosine_similarity(first: list[float], second: list[float]) -> float:
    numerator = sum(left * right for left, right in zip(first, second))
    first_norm = math.sqrt(sum(value * value for value in first))
    second_norm = math.sqrt(sum(value * value for value in second))
    if first_norm == 0 or second_norm == 0:
        return 0.0
    return numerator / (first_norm * second_norm)


def retrieve_documents(query: str, limit: int = 4) -> list[Document]:
    if not INDEX_CACHE["documents"]:
        chunk_count = build_vectorstore()
        if chunk_count == 0:
            raise HTTPException(
                status_code=500,
                detail="No knowledge documents found. Add files to backend/data and rebuild the index.",
            )

    query_vector = get_embeddings().embed_query(query)
    ranked_documents: list[tuple[float, Document]] = []
    for document, vector in zip(INDEX_CACHE["documents"], INDEX_CACHE["vectors"]):
        score = cosine_similarity(query_vector, vector)
        ranked_documents.append((score, document))

    ranked_documents.sort(key=lambda item: item[0], reverse=True)
    return [document for score, document in ranked_documents[:limit] if score > 0]


def get_session(session_id: str | None) -> tuple[str, SessionMemory]:
    if session_id and session_id in SESSIONS:
        return session_id, SESSIONS[session_id]

    new_session_id = str(uuid4())
    memory: SessionMemory = {"messages": []}
    SESSIONS[new_session_id] = memory
    return new_session_id, memory


def summarize_history(messages: list[BaseMessage]) -> str:
    recent_messages = messages[-MAX_HISTORY:]
    lines: list[str] = []
    for message in recent_messages:
        role = "User" if isinstance(message, HumanMessage) else "Assistant"
        lines.append(f"{role}: {message.content}")
    return "\n".join(lines) if lines else "No previous conversation."


def route_question(state: GraphState) -> dict[str, Any]:
    question = state["question"].lower()
    small_talk_keywords = ["hi", "hello", "thanks", "thank you", "bye"]
    if any(keyword in question for keyword in small_talk_keywords) and len(question.split()) <= 4:
        return {"route": "smalltalk"}
    return {"route": "retrieve"}


def retrieve_context(state: GraphState) -> dict[str, Any]:
    docs = retrieve_documents(state["question"], limit=4)
    return {"retrieved_docs": docs}


def answer_with_context(state: GraphState) -> dict[str, Any]:
    llm = get_llm()
    prompt = ChatPromptTemplate.from_template(
        """
You are a document-grounded AI assistant.
Answer only from the provided retrieved context and the recent conversation history.
Do not claim you are limited to e-commerce, customer support, or any fixed domain.
If the answer is not supported by the retrieved context, say clearly:
"I don't have enough information from the uploaded documents to answer that."
If the user asks who a document belongs to, identify the person only if the retrieved context contains that name explicitly.
Answer naturally, directly, and briefly.

Conversation history:
{history}

Retrieved context:
{context}

Question:
{question}
"""
    )
    context = "\n\n".join(
        f"Source: {doc.metadata.get('source', 'unknown')}\n{doc.page_content}"
        for doc in state["retrieved_docs"]
    )
    chain = prompt | llm
    response = chain.invoke(
        {
            "history": summarize_history(state["chat_history"]),
            "context": context or "No relevant context retrieved.",
            "question": state["question"],
        }
    )
    return {"answer": response.content}


def answer_smalltalk(state: GraphState) -> dict[str, Any]:
    llm = get_llm()
    prompt = ChatPromptTemplate.from_template(
        """
You are a polite general AI assistant for uploaded documents.
Respond conversationally to the user's short message.
Do not claim to be an e-commerce or store assistant.
If the message is asking about document content, invite the user to ask a direct question about the uploaded files.

Conversation history:
{history}

User message:
{question}
"""
    )
    chain = prompt | llm
    response = chain.invoke(
        {
            "history": summarize_history(state["chat_history"]),
            "question": state["question"],
        }
    )
    return {"answer": response.content, "retrieved_docs": []}


def decide_next_step(state: GraphState) -> Literal["retrieve_context", "answer_smalltalk"]:
    return "answer_smalltalk" if state["route"] == "smalltalk" else "retrieve_context"


def compile_graph():
    graph = StateGraph(GraphState)
    graph.add_node("route_question", route_question)
    graph.add_node("retrieve_context", retrieve_context)
    graph.add_node("answer_with_context", answer_with_context)
    graph.add_node("answer_smalltalk", answer_smalltalk)

    graph.add_edge(START, "route_question")
    graph.add_conditional_edges(
        "route_question",
        decide_next_step,
        {
            "retrieve_context": "retrieve_context",
            "answer_smalltalk": "answer_smalltalk",
        },
    )
    graph.add_edge("retrieve_context", "answer_with_context")
    graph.add_edge("answer_with_context", END)
    graph.add_edge("answer_smalltalk", END)
    return graph.compile()


rag_graph = compile_graph()


@app.on_event("startup")
def startup_index() -> None:
    if DOCS_DIR.exists() and any(path.is_file() for path in DOCS_DIR.rglob("*")):
        try:
            build_vectorstore()
        except Exception:
            # Indexing is retried lazily from the chat or rebuild endpoint.
            pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/rebuild-index")
def rebuild_index() -> dict[str, Any]:
    chunk_count = build_vectorstore()
    return {"chunks_indexed": chunk_count}


@app.post("/upload-documents", response_model=UploadResponse)
async def upload_documents(files: list[UploadFile] = File(...)) -> UploadResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    uploaded_files: list[str] = []

    for file in files:
        filename = validate_upload(file)
        content = await file.read()
        target_path = DOCS_DIR / filename
        target_path.write_bytes(content)
        uploaded_files.append(filename)

    chunk_count = build_vectorstore()
    return UploadResponse(uploaded_files=uploaded_files, chunks_indexed=chunk_count)


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    session_id, memory = get_session(request.session_id)

    state = rag_graph.invoke(
        {
            "question": request.message,
            "chat_history": memory["messages"],
            "route": "",
            "retrieved_docs": [],
            "answer": "",
        }
    )

    answer = state["answer"].strip()
    memory["messages"].append(HumanMessage(content=request.message))
    memory["messages"].append(AIMessage(content=answer))
    memory["messages"] = memory["messages"][-(MAX_HISTORY * 2) :]

    retrieved_docs = state.get("retrieved_docs", [])
    sources = sorted(
        {
            doc.metadata.get("source", "unknown")
            for doc in retrieved_docs
            if isinstance(doc, Document)
        }
    )

    chunk_payload = [
        {
            "source": doc.metadata.get("source", "unknown"),
            "preview": doc.page_content[:240].strip(),
        }
        for doc in retrieved_docs
        if isinstance(doc, Document)
    ]

    return ChatResponse(
        session_id=session_id,
        answer=answer,
        route=state.get("route", "retrieve"),
        retrieved_chunks=chunk_payload,
        sources=sources,
        used_context=bool(retrieved_docs),
    )
