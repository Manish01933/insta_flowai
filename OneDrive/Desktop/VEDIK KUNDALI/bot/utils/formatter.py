"""
Message Formatting Utilities
"""
from typing import List, Optional


def format_message(text: str, max_length: int = 4096) -> str:
    """
    Format message for Telegram with proper length handling
    
    Args:
        text: Message text
        max_length: Maximum length (Telegram limit is 4096)
    
    Returns:
        Formatted message
    """
    if len(text) <= max_length:
        return text
    
    # Truncate and add continuation indicator
    truncated = text[:max_length - 20]
    return truncated + "\n\n... (message truncated)"


def truncate_words(text: str, max_words: int = 400) -> str:
    """
    Truncate text to maximum number of words
    
    Args:
        text: Text to truncate
        max_words: Maximum number of words
    
    Returns:
        Truncated text
    """
    words = text.split()
    
    if len(words) <= max_words:
        return text
    
    truncated = ' '.join(words[:max_words])
    return truncated + "..."


def format_birth_details(dob: str, tob: str, pob: str) -> str:
    """
    Format birth details for display
    
    Args:
        dob: Date of birth
        tob: Time of birth
        pob: Place of birth
    
    Returns:
        Formatted birth details
    """
    return f"""
📅 Date of Birth: {dob}
🕐 Time of Birth: {tob}
📍 Place of Birth: {pob}
"""


def format_analysis_section(title: str, content: str) -> str:
    """
    Format an analysis section with title and content
    
    Args:
        title: Section title
        content: Section content
    
    Returns:
        Formatted section
    """
    return f"**{title}**\n\n{content}\n"


def format_list(items: List[str], bullet: str = "•") -> str:
    """
    Format a list of items
    
    Args:
        items: List of items
        bullet: Bullet character
    
    Returns:
        Formatted list
    """
    return "\n".join(f"{bullet} {item}" for item in items)


def format_table(headers: List[str], rows: List[List[str]]) -> str:
    """
    Format a simple table
    
    Args:
        headers: Table headers
        rows: Table rows
    
    Returns:
        Formatted table
    """
    lines = []
    
    # Header
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "|".join(["---" for _ in headers]) + "|")
    
    # Rows
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    
    return "\n".join(lines)


def sanitize_text(text: str) -> str:
    """
    Sanitize text for Telegram Markdown
    
    Args:
        text: Text to sanitize
    
    Returns:
        Sanitized text
    """
    # Escape Markdown special characters
    escape_chars = ['*', '_', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!']
    
    for char in escape_chars:
        text = text.replace(char, '\\' + char)
    
    return text


def create_button_text(buttons: List[dict]) -> str:
    """
    Create button text for inline keyboard
    
    Args:
        buttons: List of button dictionaries with 'text' and 'callback_data'
    
    Returns:
        Formatted button text
    """
    return "\n".join(f"🔘 {btn['text']}" for btn in buttons)
