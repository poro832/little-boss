from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime
import uuid


@dataclass
class Deadline:
    date: str           # YYYY-MM-DD
    description: str
    urgency: str = "normal"  # high | normal | low


@dataclass
class RequiredDocument:
    name: str
    description: str
    have: bool = False


@dataclass
class CalendarEvent:
    title: str
    date: str           # YYYY-MM-DD
    description: str = ""
    time: str = "23:59"
    location: str = ""


@dataclass
class AnalysisResult:
    document_type: str
    deadlines: List[Deadline] = field(default_factory=list)
    required_documents: List[RequiredDocument] = field(default_factory=list)
    calendar_events: List[CalendarEvent] = field(default_factory=list)
    summary: str = ""


@dataclass
class Document:
    doc_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = "local_user"
    filename: str = ""
    status: str = "pending"     # pending | processing | done | error
    raw_text: str = ""
    analysis: Optional[AnalysisResult] = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    error_message: str = ""
