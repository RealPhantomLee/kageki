"""
Notes import service for handling multiple note format imports.
Supports: Obsidian Markdown, Apple Notes ENEX, Google Docs HTML, Notion ZIP, ChatGPT ZIP.
"""

import io
import json
import zipfile
import logging
from typing import List
from xml.etree import ElementTree

try:
    import html2text
except ImportError:
    html2text = None

log = logging.getLogger(__name__)


class NoteData:
    """Simple data class for imported notes"""
    def __init__(self, title: str, content: str, tags: list = None):
        self.title = title
        self.content = content
        self.tags = tags or []


async def import_obsidian_md(file_bytes: bytes) -> List[NoteData]:
    """Single .md file — extract H1 as title, rest as content"""
    content = file_bytes.decode('utf-8')
    lines = content.split('\n', 1)
    title = lines[0].replace('# ', '').strip() if lines[0].startswith('#') else 'Untitled'
    body = lines[1].strip() if len(lines) > 1 else content
    return [NoteData(title, body)]


async def import_obsidian_vault(file_bytes: bytes) -> List[NoteData]:
    """
    Obsidian vault export — unzip and extract all .md files recursively.
    Returns list of NoteData for each markdown file found.
    """
    notes = []
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            for filename in z.namelist():
                if filename.endswith('.md'):
                    try:
                        content = z.read(filename).decode('utf-8')
                        # Extract title from first H1, or use filename
                        lines = content.split('\n', 1)
                        title = lines[0].replace('# ', '').strip() if lines[0].startswith('#') else 'Untitled'
                        body = lines[1].strip() if len(lines) > 1 else content
                        if not title or title == 'Untitled':
                            title = filename.rsplit('/', 1)[-1].replace('.md', '')
                        notes.append(NoteData(title, body))
                    except Exception as e:
                        log.warning(f"Failed to import {filename}: {e}")
                        continue
    except zipfile.BadZipFile as e:
        log.error(f"Failed to extract zip file: {e}")
        raise ValueError("Invalid ZIP file provided")
    except Exception as e:
        log.error(f"Error importing obsidian vault: {e}")
        raise ValueError(f"Failed to import vault: {str(e)}")

    return notes


async def import_apple_notes_enex(file_bytes: bytes) -> List[NoteData]:
    """Apple Notes .enex XML — parse note-level <note> elements"""
    if html2text is None:
        raise ImportError("html2text is required for ENEX import")

    root = ElementTree.fromstring(file_bytes)
    notes = []
    h = html2text.HTML2Text()
    h.ignore_links = False

    for note in root.findall('.//note'):
        title_elem = note.find('title')
        content_elem = note.find('content')
        title = title_elem.text if title_elem is not None else 'Untitled'
        html_content = content_elem.text if content_elem is not None else ''
        markdown = h.handle(html_content)
        notes.append(NoteData(title, markdown))

    return notes


async def import_google_docs_html(file_bytes: bytes) -> List[NoteData]:
    """Google Docs exported HTML — convert HTML body to markdown"""
    if html2text is None:
        raise ImportError("html2text is required for HTML import")

    html_content = file_bytes.decode('utf-8')
    h = html2text.HTML2Text()
    markdown = h.handle(html_content)

    # Extract title from <title> tag if present
    title = 'Google Docs Import'
    try:
        start = html_content.find('<title>')
        end = html_content.find('</title>')
        if start != -1 and end != -1:
            title = html_content[start + 7:end].strip()
    except Exception:
        pass

    return [NoteData(title, markdown)]


async def import_notion_zip(file_bytes: bytes) -> List[NoteData]:
    """Notion export zip — find all .md files"""
    notes = []
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        for filename in z.namelist():
            if filename.endswith('.md'):
                content = z.read(filename).decode('utf-8')
                title = filename.rsplit('/', 1)[-1].replace('.md', '')
                notes.append(NoteData(title, content))

    return notes


async def import_chatgpt_zip(file_bytes: bytes) -> List[NoteData]:
    """ChatGPT export zip — parse conversations.json"""
    notes = []
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        if 'conversations.json' in z.namelist():
            conversations = json.loads(z.read('conversations.json').decode('utf-8'))
            for conv in conversations:
                title = conv.get('title', 'Untitled Conversation')
                messages = conv.get('mapping', {})

                # Format as markdown transcript: **User:** / **Assistant:**
                transcript = []
                for msg_id, msg_data in messages.items():
                    if msg_data.get('message'):
                        role = msg_data['message'].get('author', {}).get('role', 'unknown')
                        content = msg_data['message'].get('content', {}).get('parts', [])
                        if content:
                            text = ' '.join(str(part) for part in content)
                            if role == 'user':
                                transcript.append(f"**User:** {text}")
                            elif role == 'assistant':
                                transcript.append(f"**Assistant:** {text}")

                markdown = '\n\n'.join(transcript)
                notes.append(NoteData(title, markdown))

    return notes
