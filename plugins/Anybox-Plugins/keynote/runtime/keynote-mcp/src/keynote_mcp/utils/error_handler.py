"""
Error handling utilities for Keynote-MCP
"""

import re
from typing import Optional


class KeynoteError(Exception):
    """Base exception for Keynote operations"""
    pass


class AppleScriptError(KeynoteError):
    """AppleScript execution error"""
    pass


class FileOperationError(KeynoteError):
    """File operation error"""
    pass


class ParameterError(KeynoteError):
    """Parameter validation error"""
    pass


def handle_applescript_error(error_output: str) -> None:
    """Handle AppleScript error output"""
    if not error_output:
        return
    
    error_output = error_output.strip()
    
    # Keynote application error
    if "Keynote got an error" in error_output:
        raise AppleScriptError(f"Keynote error: {error_output}")
    
    # Object not found error
    elif "Can't get" in error_output:
        raise AppleScriptError(f"Object not found: {error_output}")
    
    # Permission error
    elif "not allowed" in error_output or "permission" in error_output.lower():
        raise AppleScriptError(f"Permission denied: {error_output}")
    
    # File operation error
    elif "file" in error_output.lower() and ("not found" in error_output.lower() or "doesn't exist" in error_output.lower()):
        raise FileOperationError(f"File operation error: {error_output}")
    
    # Syntax error
    elif "syntax error" in error_output.lower():
        raise AppleScriptError(f"AppleScript syntax error: {error_output}")
    
    # Other errors
    else:
        raise AppleScriptError(f"Unknown AppleScript error: {error_output}")


def validate_slide_number(slide_number: Optional[int], max_slides: Optional[int] = None) -> int:
    """Validate slide number"""
    if slide_number is None:
        raise ParameterError("Slide number is required")
    
    if not isinstance(slide_number, int) or slide_number < 1:
        raise ParameterError(f"Invalid slide number: {slide_number}. Must be a positive integer.")
    
    if max_slides is not None and slide_number > max_slides:
        raise ParameterError(f"Slide number {slide_number} exceeds maximum slides {max_slides}")
    
    return slide_number


def validate_coordinates(x: Optional[float], y: Optional[float]) -> tuple[float, float]:
    """Validate coordinate values"""
    if x is not None and (not isinstance(x, (int, float)) or x < 0):
        raise ParameterError(f"Invalid x coordinate: {x}")
    
    if y is not None and (not isinstance(y, (int, float)) or y < 0):
        raise ParameterError(f"Invalid y coordinate: {y}")
    
    return float(x) if x is not None else 0.0, float(y) if y is not None else 0.0


def validate_file_path(file_path: str) -> str:
    """Validate file path"""
    if not file_path or not isinstance(file_path, str):
        raise ParameterError("File path is required and must be a string")
    
    # Basic path validation
    if not file_path.strip():
        raise ParameterError("File path cannot be empty")
    
    return file_path.strip()


VALID_ELEMENT_TYPES = {"text", "image", "shape", "table"}


def validate_element_type(element_type: str) -> str:
    """Validate element type"""
    if element_type not in VALID_ELEMENT_TYPES:
        raise ParameterError(f"Invalid element type: {element_type}. Must be one of: {VALID_ELEMENT_TYPES}")
    return element_type


def validate_dimensions(width: float, height: float) -> tuple[float, float]:
    """Validate width and height dimensions"""
    if width is not None and (not isinstance(width, (int, float)) or width <= 0):
        raise ParameterError(f"Invalid width: {width}. Must be positive.")
    if height is not None and (not isinstance(height, (int, float)) or height <= 0):
        raise ParameterError(f"Invalid height: {height}. Must be positive.")
    return float(width) if width is not None else 0.0, float(height) if height is not None else 0.0