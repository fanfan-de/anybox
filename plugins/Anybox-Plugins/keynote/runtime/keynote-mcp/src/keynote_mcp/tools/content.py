"""
Content management tools
"""

from typing import Any, Dict, List, Optional
from mcp.types import Tool, TextContent
from ..utils import AppleScriptRunner, validate_slide_number, validate_coordinates, validate_file_path, validate_element_type, validate_dimensions, ParameterError


class ContentTools:
    """Content management tools class"""
    
    def __init__(self):
        self.runner = AppleScriptRunner()
    
    def get_tools(self) -> List[Tool]:
        """Get all content management tools"""
        return [
            Tool(
                name="add_text_box",
                description="Add a text box to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "text": {
                            "type": "string",
                            "description": "Text content"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Origin (0,0) is top-left. Suggested: 50-950px"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Origin (0,0) is top-left. Suggested: 50-650px"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional)"
                        },
                        "color": {
                            "type": "string",
                            "description": "Text color as 'r,g,b' with values 0-65535 (optional, e.g. '65535,65535,65535' for white)"
                        }
                    },
                    "required": ["slide_number", "text"]
                }
            ),
            Tool(
                name="add_title",
                description="Add a title to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "title": {
                            "type": "string",
                            "description": "Title text"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for title: 100-200"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for title: 50-100"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional, default 36)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional)"
                        }
                    },
                    "required": ["slide_number", "title"]
                }
            ),
            Tool(
                name="add_subtitle",
                description="Add a subtitle to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "subtitle": {
                            "type": "string",
                            "description": "Subtitle text"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for subtitle: 100-200"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for subtitle: 120-180"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional, default 24)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional)"
                        }
                    },
                    "required": ["slide_number", "subtitle"]
                }
            ),
            Tool(
                name="add_bullet_list",
                description="Add a bullet list to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List items"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for list: 100-150"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for list: 200-300"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional, default 18)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional)"
                        }
                    },
                    "required": ["slide_number", "items"]
                }
            ),
            Tool(
                name="add_numbered_list",
                description="Add a numbered list to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List items"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for list: 100-150"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for list: 200-300"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional, default 18)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional)"
                        }
                    },
                    "required": ["slide_number", "items"]
                }
            ),
            Tool(
                name="add_code_block",
                description="Add a code block to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "code": {
                            "type": "string",
                            "description": "Code content"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for code: 100-200"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for code: 250-350"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional, default 14)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional, default Monaco)"
                        },
                        "color": {
                            "type": "string",
                            "description": "Text color as 'r,g,b' with values 0-65535 (optional, e.g. '65535,65535,65535' for white)"
                        }
                    },
                    "required": ["slide_number", "code"]
                }
            ),
            Tool(
                name="add_quote",
                description="Add a quote to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "quote": {
                            "type": "string",
                            "description": "Quote text"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for quote: 150-250"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for quote: 300-400"
                        },
                        "font_size": {
                            "type": "number",
                            "description": "Font size (optional, default 20)"
                        },
                        "font_name": {
                            "type": "string",
                            "description": "Font name (optional)"
                        }
                    },
                    "required": ["slide_number", "quote"]
                }
            ),
            Tool(
                name="add_image",
                description="Add an image to a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "image_path": {
                            "type": "string",
                            "description": "Path to the image file"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional). Suggested for image: 400-600"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional). Suggested for image: 200-400"
                        }
                    },
                    "required": ["slide_number", "image_path"]
                }
            ),
            Tool(
                name="get_slide_content",
                description="Get all elements on a slide — returns counts and details for text items, images, shapes, and tables",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="edit_text_item",
                description="Edit a text item's content by index on a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "item_index": {
                            "type": "integer",
                            "description": "Text item index (1-based)"
                        },
                        "new_text": {
                            "type": "string",
                            "description": "New text content"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number", "item_index", "new_text"]
                }
            ),
            Tool(
                name="delete_element",
                description="Delete an element by type and index from a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, shape, or table",
                            "enum": ["text", "image", "shape", "table"]
                        },
                        "element_index": {
                            "type": "integer",
                            "description": "Element index (1-based)"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number", "element_type", "element_index"]
                }
            ),
            Tool(
                name="move_element",
                description="Move an element to new coordinates on a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, shape, or table",
                            "enum": ["text", "image", "shape", "table"]
                        },
                        "element_index": {
                            "type": "integer",
                            "description": "Element index (1-based)"
                        },
                        "x": {
                            "type": "number",
                            "description": "New X coordinate in pixels"
                        },
                        "y": {
                            "type": "number",
                            "description": "New Y coordinate in pixels"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number", "element_type", "element_index", "x", "y"]
                }
            ),
            Tool(
                name="resize_element",
                description="Resize an element on a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, shape, or table",
                            "enum": ["text", "image", "shape", "table"]
                        },
                        "element_index": {
                            "type": "integer",
                            "description": "Element index (1-based)"
                        },
                        "width": {
                            "type": "number",
                            "description": "New width in pixels"
                        },
                        "height": {
                            "type": "number",
                            "description": "New height in pixels"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number", "element_type", "element_index", "width", "height"]
                }
            ),
            Tool(
                name="get_speaker_notes",
                description="Get presenter notes from a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="set_speaker_notes",
                description="Set presenter notes on a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "notes": {
                            "type": "string",
                            "description": "Notes text"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number", "notes"]
                }
            ),
            Tool(
                name="clear_slide",
                description="Clear all user-created content from a slide, preserving background images and theme placeholders",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="set_element_opacity",
                description="Set opacity (0-100) on any element",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, shape, or table",
                            "enum": ["text", "image", "shape", "table"]
                        },
                        "element_index": {
                            "type": "integer",
                            "description": "Element index (1-based)"
                        },
                        "opacity": {
                            "type": "number",
                            "description": "Opacity value (0-100)"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number", "element_type", "element_index", "opacity"]
                }
            ),
            Tool(
                name="add_build_in",
                description="Add a Build In animation to an element so it appears step-by-step (e.g. bullets one by one on click). Uses UI scripting — requires Accessibility permissions.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, or shape",
                            "enum": ["text", "image", "shape"]
                        },
                        "element_index": {
                            "type": "integer",
                            "description": "Element index (1-based)"
                        },
                        "effect": {
                            "type": "string",
                            "description": "Animation effect name (default: Appear). Options: Appear, Dissolve, Fly In, Move In, Fade and Move, etc.",
                            "default": "Appear"
                        },
                        "delivery": {
                            "type": "string",
                            "description": "How to deliver the animation. Options: All at Once, By Paragraph, By Paragraph Group, By Highlighted Paragraph",
                            "default": "By Paragraph"
                        }
                    },
                    "required": ["slide_number", "element_type", "element_index"]
                }
            ),
            Tool(
                name="remove_build_in",
                description="Remove Build In animation from an element. Uses UI scripting.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, or shape",
                            "enum": ["text", "image", "shape"]
                        },
                        "element_index": {
                            "type": "integer",
                            "description": "Element index (1-based)"
                        }
                    },
                    "required": ["slide_number", "element_type", "element_index"]
                }
            ),
            Tool(
                name="add_builds_to_slide",
                description="Add Build In animations to multiple elements on a slide in one call. Applies builds in order so elements appear sequentially on click. Auto-skips bullet dots (text items containing only '•'). Uses UI scripting.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Element type: text, image, or shape",
                            "enum": ["text", "image", "shape"],
                            "default": "text"
                        },
                        "element_indices": {
                            "type": "string",
                            "description": "Comma-separated element indices (1-based), e.g. '5,7,9,11,13'. Use get_slide_content to find indices."
                        },
                        "effect": {
                            "type": "string",
                            "description": "Animation effect (default: Appear)",
                            "default": "Appear"
                        }
                    },
                    "required": ["slide_number", "element_indices"]
                }
            ),
            Tool(
                name="add_shape",
                description="Create a rectangle shape with optional position, size, and opacity",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "x": {
                            "type": "number",
                            "description": "X coordinate in pixels (optional)"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate in pixels (optional)"
                        },
                        "width": {
                            "type": "number",
                            "description": "Width in pixels (optional, default 200)"
                        },
                        "height": {
                            "type": "number",
                            "description": "Height in pixels (optional, default 200)"
                        },
                        "opacity": {
                            "type": "number",
                            "description": "Opacity value 0-100 (optional, default 100)"
                        },
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    },
                    "required": ["slide_number"]
                }
            )
        ]
    
    async def add_text_box(self, slide_number: int, text: str, x: Optional[float] = None, y: Optional[float] = None,
                          font_size: Optional[float] = None, font_name: str = "", color: str = "", doc_name: str = "") -> List[TextContent]:
        """Add text box"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Escape quotes in text
            escaped_text = text.replace('"', '\\"')

            # Build optional tell block commands
            tell_commands = []
            if font_size is not None:
                tell_commands.append(f"set size of object text to {font_size}")
            if font_name:
                tell_commands.append(f'set font of object text to "{font_name}"')
            if color:
                tell_commands.append(f"set color of object text to {{{color.replace(',', ', ')}}}")

            tell_block = ""
            if tell_commands:
                tell_block = "tell newTextBox\n" + "\n".join(f"                                {cmd}" for cmd in tell_commands) + "\n                            end tell"

            # Use inline script with correct syntax
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if

                    tell targetDoc
                        tell slide {slide_number}
                            -- Create text box
                            set newTextBox to make new text item with properties {{object text:"{escaped_text}"}}

                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newTextBox to {{{x_pos}, {y_pos}}}"}

                            {tell_block if tell_block else "-- no font/color specified"}
                        end tell
                    end tell

                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added text box to slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add text box: {str(e)}"
            )]
    
    async def add_title(self, slide_number: int, title: str, x: Optional[float] = None, y: Optional[float] = None, 
                       font_size: Optional[int] = None, font_name: str = "", doc_name: str = "") -> List[TextContent]:
        """Add title"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Escape quotes in text
            escaped_title = title.replace('"', '\\"')

            # Build font setting command
            font_command = f'set font of object text to "{font_name}"' if font_name else ""
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if
                    
                    tell targetDoc
                        tell slide {slide_number}
                            set newTitle to make new text item with properties {{object text:"{escaped_title}"}}
                            
                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newTitle to {{{x_pos}, {y_pos}}}"}
                            
                            tell newTitle
                                set size of object text to {font_size if font_size else 36}
                                {font_command if font_command else "-- no font specified"}
                            end tell
                        end tell
                    end tell
                    
                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added title to slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add title: {str(e)}"
            )]
    
    async def add_subtitle(self, slide_number: int, subtitle: str, x: Optional[float] = None, y: Optional[float] = None, 
                          font_size: Optional[int] = None, font_name: str = "", doc_name: str = "") -> List[TextContent]:
        """Add subtitle"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Escape quotes in text
            escaped_subtitle = subtitle.replace('"', '\\"')

            # Build font setting command
            font_command = f'set font of object text to "{font_name}"' if font_name else ""
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if
                    
                    tell targetDoc
                        tell slide {slide_number}
                            set newSubtitle to make new text item with properties {{object text:"{escaped_subtitle}"}}
                            
                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newSubtitle to {{{x_pos}, {y_pos}}}"}
                            
                            tell newSubtitle
                                set size of object text to {font_size if font_size else 24}
                                {font_command if font_command else "-- no font specified"}
                            end tell
                        end tell
                    end tell
                    
                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added subtitle to slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add subtitle: {str(e)}"
            )]
    
    async def add_bullet_list(self, slide_number: int, items: List[str], x: Optional[float] = None, y: Optional[float] = None, 
                             font_size: Optional[int] = None, font_name: str = "", doc_name: str = "") -> List[TextContent]:
        """Add bullet list"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Build list text
            list_text = ""
            for i, item in enumerate(items):
                escaped_item = item.replace('"', '\\"')
                list_text += f"• {escaped_item}"
                if i < len(items) - 1:
                    list_text += "\\n"
            
            # Build font setting command
            font_command = f'set font of object text to "{font_name}"' if font_name else ""
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if
                    
                    tell targetDoc
                        tell slide {slide_number}
                            set newList to make new text item with properties {{object text:"{list_text}"}}
                            
                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newList to {{{x_pos}, {y_pos}}}"}
                            
                            tell newList
                                set size of object text to {font_size if font_size else 18}
                                {font_command if font_command else "-- no font specified"}
                            end tell
                        end tell
                    end tell
                    
                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added bullet list to slide {slide_number} ({len(items)} items)"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add bullet list: {str(e)}"
            )]
    
    async def add_numbered_list(self, slide_number: int, items: List[str], x: Optional[float] = None, y: Optional[float] = None, 
                               font_size: Optional[int] = None, font_name: str = "", doc_name: str = "") -> List[TextContent]:
        """Add numbered list"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Build numbered list text
            list_text = ""
            for i, item in enumerate(items):
                escaped_item = item.replace('"', '\\"')
                list_text += f"{i+1}. {escaped_item}"
                if i < len(items) - 1:
                    list_text += "\\n"
            
            # Build font setting command
            font_command = f'set font of object text to "{font_name}"' if font_name else ""
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if
                    
                    tell targetDoc
                        tell slide {slide_number}
                            set newList to make new text item with properties {{object text:"{list_text}"}}
                            
                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newList to {{{x_pos}, {y_pos}}}"}
                            
                            tell newList
                                set size of object text to {font_size if font_size else 18}
                                {font_command if font_command else "-- no font specified"}
                            end tell
                        end tell
                    end tell
                    
                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added numbered list to slide {slide_number} ({len(items)} items)"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add numbered list: {str(e)}"
            )]
    
    async def add_code_block(self, slide_number: int, code: str, x: Optional[float] = None, y: Optional[float] = None,
                            font_size: Optional[int] = None, font_name: str = "", color: str = "", doc_name: str = "") -> List[TextContent]:
        """Add code block"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Escape quotes and newlines in code
            escaped_code = code.replace('"', '\\"').replace('\n', '\\n')

            # Build color command if provided
            color_command = f"set color of object text to {{{color.replace(',', ', ')}}}" if color else "-- no color specified"

            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if

                    tell targetDoc
                        tell slide {slide_number}
                            set newCodeBlock to make new text item with properties {{object text:"{escaped_code}"}}

                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newCodeBlock to {{{x_pos}, {y_pos}}}"}

                            tell newCodeBlock
                                set size of object text to {font_size if font_size else 14}
                                set font of object text to "{font_name if font_name else 'Monaco'}"
                                {color_command}
                            end tell
                        end tell
                    end tell

                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added code block to slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add code block: {str(e)}"
            )]
    
    async def add_quote(self, slide_number: int, quote: str, x: Optional[float] = None, y: Optional[float] = None, 
                       font_size: Optional[int] = None, font_name: str = "", doc_name: str = "") -> List[TextContent]:
        """Add quote"""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)

            # Escape quotes in quote text
            escaped_quote = quote.replace('"', '\\"')
            # Wrap in single quotes to avoid nested quote issues
            formatted_quote = f"'{escaped_quote}'"
            
            # Build font setting command
            font_command = f'set font of object text to "{font_name}"' if font_name else ""
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is not "" then
                        set targetDoc to document "{doc_name}"
                    else
                        set targetDoc to front document
                    end if
                    
                    tell targetDoc
                        tell slide {slide_number}
                            set newQuote to make new text item with properties {{object text:"{formatted_quote}"}}
                            
                            -- Set position (if x or y coordinates are specified)
                            {"" if x is None and y is None else f"set position of newQuote to {{{x_pos}, {y_pos}}}"}
                            
                            tell newQuote
                                set size of object text to {font_size if font_size else 20}
                                {font_command if font_command else "-- no font specified"}
                            end tell
                        end tell
                    end tell
                    
                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Added quote to slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add quote: {str(e)}"
            )]
    
    async def add_image(self, slide_number: int, image_path: str, x: Optional[float] = None, y: Optional[float] = None) -> List[TextContent]:
        """Add image"""
        try:
            validate_slide_number(slide_number)
            validate_file_path(image_path)
            x_pos, y_pos = validate_coordinates(x, y)

            # Build position parameters
            position_params = ""
            if x is not None and y is not None:
                position_params = f", position:{{{x_pos}, {y_pos}}}"

            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    set targetDoc to front document

                    tell targetDoc
                        tell slide {slide_number}
                            -- Use correct alias syntax
                            set imageFile to POSIX file "{image_path}" as alias

                            -- Method 1: Try standard image object
                            try
                                set newImage to make new image with properties {{file:imageFile{position_params}}}
                                return "image_success"
                            on error
                                -- Method 2: Try movie object (works in some Keynote versions)
                                try
                                    set newMovie to make new movie with properties {{file:imageFile{position_params}}}
                                    return "movie_success"
                                on error
                                    -- Method 3: Use clipboard method
                                    try
                                        tell application "Finder"
                                            select imageFile
                                            copy selection
                                        end tell

                                        delay 0.5
                                        paste

                                        return "clipboard_success"
                                    on error
                                        error "All image insertion methods failed"
                                    end try
                                end try
                            end try
                        end tell
                    end tell
                end tell
            ''')

            return [TextContent(
                type="text",
                text=f"✅ Added image to slide {slide_number} (method: {result})"
            )]

        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add image: {str(e)}"
            )]

    # --- Read / Edit / Delete tools ---

    _ELEMENT_TYPE_MAP = {
        "text": "text item",
        "image": "image",
        "shape": "shape",
        "table": "table",
    }

    def _doc_tell(self, doc_name: str) -> str:
        """Return AppleScript fragment to target a document."""
        return (
            f'set targetDoc to document "{doc_name}"'
            if doc_name
            else "set targetDoc to front document"
        )

    async def get_slide_content(self, slide_number: int, doc_name: str = "") -> List[TextContent]:
        """Get all elements on a slide."""
        try:
            validate_slide_number(slide_number)
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        set textCount to count of text items
                        set imageCount to count of images
                        set shapeCount to count of shapes
                        set tableCount to count of tables

                        set output to "text_items:" & textCount & "|images:" & imageCount & "|shapes:" & shapeCount & "|tables:" & tableCount

                        repeat with i from 1 to textCount
                            set ti to text item i
                            set txt to object text of ti
                            set pos to position of ti
                            set w to width of ti
                            set h to height of ti
                            set output to output & "|||TEXT:" & i & ":::" & txt & ":::" & (item 1 of pos) & "," & (item 2 of pos) & ":::" & w & "," & h
                        end repeat

                        repeat with i from 1 to imageCount
                            set img to image i
                            set pos to position of img
                            set w to width of img
                            set h to height of img
                            set output to output & "|||IMAGE:" & i & ":::" & (item 1 of pos) & "," & (item 2 of pos) & ":::" & w & "," & h
                        end repeat

                        repeat with i from 1 to shapeCount
                            set sh to shape i
                            set pos to position of sh
                            set w to width of sh
                            set h to height of sh
                            set output to output & "|||SHAPE:" & i & ":::" & (item 1 of pos) & "," & (item 2 of pos) & ":::" & w & "," & h
                        end repeat

                        repeat with i from 1 to tableCount
                            set tb to table i
                            set pos to position of tb
                            set w to width of tb
                            set h to height of tb
                            set output to output & "|||TABLE:" & i & ":::" & (item 1 of pos) & "," & (item 2 of pos) & ":::" & w & "," & h
                        end repeat

                        return output
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=result)]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to get slide content: {str(e)}")]

    async def edit_text_item(self, slide_number: int, item_index: int, new_text: str, doc_name: str = "") -> List[TextContent]:
        """Edit a text item's content by index."""
        try:
            validate_slide_number(slide_number)
            if not isinstance(item_index, int) or item_index < 1:
                raise ParameterError(f"Invalid item_index: {item_index}. Must be a positive integer.")
            escaped_text = new_text.replace('"', '\\"')
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        set object text of text item {item_index} to "{escaped_text}"
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Text item {item_index} on slide {slide_number} updated.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to edit text item: {str(e)}")]

    async def delete_element(self, slide_number: int, element_type: str, element_index: int, doc_name: str = "") -> List[TextContent]:
        """Delete an element by type and index."""
        try:
            validate_slide_number(slide_number)
            validate_element_type(element_type)
            if not isinstance(element_index, int) or element_index < 1:
                raise ParameterError(f"Invalid element_index: {element_index}. Must be a positive integer.")
            as_type = self._ELEMENT_TYPE_MAP[element_type]
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        delete {as_type} {element_index}
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Deleted {element_type} {element_index} from slide {slide_number}.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to delete element: {str(e)}")]

    async def move_element(self, slide_number: int, element_type: str, element_index: int, x: float, y: float, doc_name: str = "") -> List[TextContent]:
        """Move an element to new coordinates."""
        try:
            validate_slide_number(slide_number)
            validate_element_type(element_type)
            if not isinstance(element_index, int) or element_index < 1:
                raise ParameterError(f"Invalid element_index: {element_index}. Must be a positive integer.")
            x_pos, y_pos = validate_coordinates(x, y)
            as_type = self._ELEMENT_TYPE_MAP[element_type]
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        set position of {as_type} {element_index} to {{{x_pos}, {y_pos}}}
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Moved {element_type} {element_index} on slide {slide_number} to ({x_pos}, {y_pos}).")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to move element: {str(e)}")]

    async def resize_element(self, slide_number: int, element_type: str, element_index: int, width: float, height: float, doc_name: str = "") -> List[TextContent]:
        """Resize an element."""
        try:
            validate_slide_number(slide_number)
            validate_element_type(element_type)
            if not isinstance(element_index, int) or element_index < 1:
                raise ParameterError(f"Invalid element_index: {element_index}. Must be a positive integer.")
            w, h = validate_dimensions(width, height)
            as_type = self._ELEMENT_TYPE_MAP[element_type]
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        set width of {as_type} {element_index} to {w}
                        set height of {as_type} {element_index} to {h}
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Resized {element_type} {element_index} on slide {slide_number} to {w}x{h}.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to resize element: {str(e)}")]

    async def get_speaker_notes(self, slide_number: int, doc_name: str = "") -> List[TextContent]:
        """Get presenter notes from a slide."""
        try:
            validate_slide_number(slide_number)
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    return presenter notes of slide {slide_number} of targetDoc
                end tell
            ''')
            return [TextContent(type="text", text=result)]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to get speaker notes: {str(e)}")]

    async def set_speaker_notes(self, slide_number: int, notes: str, doc_name: str = "") -> List[TextContent]:
        """Set presenter notes on a slide."""
        try:
            validate_slide_number(slide_number)
            escaped_notes = notes.replace('"', '\\"')
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    set presenter notes of slide {slide_number} of targetDoc to "{escaped_notes}"
                end tell
            ''')
            return [TextContent(type="text", text=f"Speaker notes set on slide {slide_number}.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to set speaker notes: {str(e)}")]

    async def clear_slide(self, slide_number: int, doc_name: str = "") -> List[TextContent]:
        """Clear all user-created content from a slide, preserving background images and theme placeholders."""
        try:
            validate_slide_number(slide_number)
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        -- Delete shapes from highest to lowest
                        set shapeCount to count of shapes
                        repeat with i from shapeCount to 1 by -1
                            delete shape i
                        end repeat

                        -- Delete text items from highest to lowest, SKIP theme placeholders
                        set textCount to count of text items
                        repeat with i from textCount to 1 by -1
                            set ti to text item i
                            set pos to position of ti
                            set txt to object text of ti
                            -- Skip theme placeholders (empty text at 0,0)
                            if not ((item 1 of pos) is 0 and (item 2 of pos) is 0 and txt is "") then
                                delete ti
                            end if
                        end repeat
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Cleared slide {slide_number}.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to clear slide: {str(e)}")]

    async def set_element_opacity(self, slide_number: int, element_type: str, element_index: int, opacity: float, doc_name: str = "") -> List[TextContent]:
        """Set opacity on any element."""
        try:
            validate_slide_number(slide_number)
            validate_element_type(element_type)
            if not isinstance(element_index, int) or element_index < 1:
                raise ParameterError(f"Invalid element_index: {element_index}. Must be a positive integer.")
            if opacity < 0 or opacity > 100:
                raise ParameterError(f"Invalid opacity: {opacity}. Must be between 0 and 100.")
            as_type = self._ELEMENT_TYPE_MAP[element_type]
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        set opacity of {as_type} {element_index} to {opacity}
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Set opacity of {element_type} {element_index} on slide {slide_number} to {opacity}.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to set element opacity: {str(e)}")]

    async def add_shape(self, slide_number: int, x: Optional[float] = None, y: Optional[float] = None,
                        width: Optional[float] = None, height: Optional[float] = None,
                        opacity: Optional[float] = None, doc_name: str = "") -> List[TextContent]:
        """Create a rectangle shape."""
        try:
            validate_slide_number(slide_number)
            x_pos, y_pos = validate_coordinates(x, y)
            w = width if width is not None else 200
            h = height if height is not None else 200
            op = opacity if opacity is not None else 100
            if op < 0 or op > 100:
                raise ParameterError(f"Invalid opacity: {op}. Must be between 0 and 100.")
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    {self._doc_tell(doc_name)}
                    tell slide {slide_number} of targetDoc
                        set newShape to make new shape with properties {{position:{{{x_pos}, {y_pos}}}, width:{w}, height:{h}}}
                        set opacity of newShape to {op}
                    end tell
                end tell
            ''')
            return [TextContent(type="text", text=f"Added shape to slide {slide_number} at ({x_pos}, {y_pos}), size {w}x{h}, opacity {op}.")]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to add shape: {str(e)}")]

    def _get_window_title(self, doc_name: str = "") -> str:
        """Get the Keynote window title for UI scripting."""
        result = self.runner.run_inline_script(f'''
            tell application "Keynote"
                if "{doc_name}" is "" then
                    return name of front document
                else
                    return "{doc_name}"
                end if
            end tell
        ''')
        return result.strip()

    async def add_build_in(self, slide_number: int, element_type: str, element_index: int,
                           effect: str = "Appear", delivery: str = "By Paragraph") -> List[TextContent]:
        """Add a Build In animation to an element using UI scripting (System Events)."""
        try:
            validate_slide_number(slide_number)
            as_type = self._ELEMENT_TYPE_MAP.get(element_type, "text item")
            win_title = self._get_window_title()

            # Full UI scripting flow:
            # 1. Select element  2. Open Animate inspector  3. Build In tab
            # 4. Add effect  5. Set delivery
            self.runner.run_inline_script(f'''
                -- Step 1: Select element
                tell application "Keynote"
                    activate
                    tell front document
                        set current slide to slide {slide_number}
                        set the selection to {{{as_type} {element_index} of slide {slide_number}}}
                    end tell
                end tell
                delay 0.5

                -- Step 2: Open Animate inspector
                tell application "System Events"
                    tell application process "Keynote"
                        click menu item "Animate" of menu 1 of menu item "Inspector" of menu 1 of menu bar item "View" of menu bar 1
                    end tell
                end tell
                delay 0.5

                -- Step 3: Click Build In tab (radio button 1 = Build In, 2 = Action, 3 = Build Out)
                -- Radio buttons have no name, only description, so use index
                tell application "System Events"
                    tell application process "Keynote"
                        set targetWin to window "{win_title}"
                        click radio button 1 of radio group 1 of targetWin
                    end tell
                end tell
                delay 0.3

                -- Step 4: Click "Add an Effect" or "Change" button
                tell application "System Events"
                    tell application process "Keynote"
                        set targetWin to window "{win_title}"
                        set btnName to ""
                        try
                            get button "Add an Effect" of targetWin
                            set btnName to "Add an Effect"
                        end try
                        if btnName is "" then
                            try
                                get button "Change" of targetWin
                                set btnName to "Change"
                            end try
                        end if
                        if btnName is "" then
                            error "Could not find Add an Effect or Change button"
                        end if
                        click button btnName of targetWin
                    end tell
                end tell
                -- MUST break out of tell block to let Keynote show the popover
                delay 2

                -- Select effect from popover
                -- NOTE: "Add an Effect" puts popover on the button; "Change" puts it on the window
                tell application "System Events"
                    tell application process "Keynote"
                        set targetWin to window "{win_title}"
                        set po to missing value
                        try
                            set po to pop over 1 of button "Add an Effect" of targetWin
                        end try
                        if po is missing value then
                            try
                                set po to pop over 1 of button "Change" of targetWin
                            end try
                        end if
                        if po is missing value then
                            try
                                set po to pop over 1 of targetWin
                            end try
                        end if
                        if po is missing value then
                            error "Could not find effect popover"
                        end if
                        click button "{effect}" of scroll area 1 of po
                    end tell
                end tell
                delay 0.5

                -- Step 5: Set delivery if not "All at Once"
                if "{delivery}" is not "All at Once" then
                    tell application "System Events"
                        tell application process "Keynote"
                            set targetWin to window "{win_title}"
                            -- Delivery is pop up button 3 in scroll area 1 of the window
                            set deliveryPopup to pop up button 3 of scroll area 1 of targetWin
                            click deliveryPopup
                            delay 0.3
                            click menu item "{delivery}" of menu 1 of deliveryPopup
                        end tell
                    end tell
                    delay 0.3
                end if
            ''')

            return [TextContent(
                type="text",
                text=f"Added Build In '{effect}' with delivery '{delivery}' to {element_type} {element_index} on slide {slide_number}."
            )]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to add build in: {str(e)}")]

    async def remove_build_in(self, slide_number: int, element_type: str, element_index: int) -> List[TextContent]:
        """Remove Build In animation from an element using UI scripting."""
        try:
            validate_slide_number(slide_number)
            as_type = self._ELEMENT_TYPE_MAP.get(element_type, "text item")
            win_title = self._get_window_title()

            self.runner.run_inline_script(f'''
                -- Select element
                tell application "Keynote"
                    activate
                    tell front document
                        set current slide to slide {slide_number}
                        set the selection to {{{as_type} {element_index} of slide {slide_number}}}
                    end tell
                end tell
                delay 0.5

                -- Open Animate inspector, Build In tab
                tell application "System Events"
                    tell application process "Keynote"
                        click menu item "Animate" of menu 1 of menu item "Inspector" of menu 1 of menu bar item "View" of menu bar 1
                    end tell
                end tell
                delay 0.5

                tell application "System Events"
                    tell application process "Keynote"
                        set targetWin to window "{win_title}"
                        -- Build In = radio button 1 (no name, use index)
                        click radio button 1 of radio group 1 of targetWin
                        delay 0.3

                        -- Check for "Change" button (means build exists)
                        try
                            get button "Change" of targetWin
                        on error
                            -- No build exists (button is "Add an Effect"), nothing to remove
                            return "no_build"
                        end try

                        click button "Change" of targetWin
                    end tell
                end tell
                -- MUST break out of tell block to let Keynote show the popover
                delay 2

                -- Select "None" from the popover
                -- "Change" button puts popover on the window (not on the button)
                tell application "System Events"
                    tell application process "Keynote"
                        set targetWin to window "{win_title}"
                        set po to missing value
                        try
                            set po to pop over 1 of targetWin
                        end try
                        if po is missing value then
                            try
                                set po to pop over 1 of button "Change" of targetWin
                            end try
                        end if
                        if po is missing value then
                            error "Could not find effect popover for removal"
                        end if
                        click button "None" of scroll area 1 of po
                    end tell
                end tell
                delay 0.3
            ''')

            return [TextContent(
                type="text",
                text=f"Removed Build In from {element_type} {element_index} on slide {slide_number}."
            )]
        except Exception as e:
            return [TextContent(type="text", text=f"Failed to remove build in: {str(e)}")]

    async def add_builds_to_slide(self, slide_number: int, element_indices: str,
                                   element_type: str = "text", effect: str = "Appear") -> List[TextContent]:
        """Add Build In animations to multiple elements on a slide. Skips bullet-dot-only items."""
        indices = [int(i.strip()) for i in element_indices.split(",") if i.strip()]
        if not indices:
            return [TextContent(type="text", text="No element indices provided.")]

        # Check which indices are bullet dots (text is just "•") and skip them
        as_type = self._ELEMENT_TYPE_MAP.get(element_type, "text item")
        dots_to_skip = set()
        if element_type == "text":
            try:
                result = self.runner.run_inline_script(f'''
                    tell application "Keynote"
                        tell front document
                            set dotIndices to {{}}
                            repeat with idx in {{{",".join(str(i) for i in indices)}}}
                                try
                                    set t to object text of {as_type} idx of slide {slide_number}
                                    if t is "•" or t is "• " then
                                        set end of dotIndices to idx as integer
                                    end if
                                end try
                            end repeat
                            set AppleScript's text item delimiters to ","
                            return dotIndices as text
                        end tell
                    end tell
                ''')
                if result.strip():
                    dots_to_skip = set(int(x) for x in result.strip().split(",") if x.strip())
            except Exception:
                pass  # If check fails, don't skip anything

        results = []
        for idx in indices:
            if idx in dots_to_skip:
                results.append(f"text {idx}: skipped (bullet dot)")
                continue
            try:
                r = await self.add_build_in(slide_number, element_type, idx, effect, "All at Once")
                results.append(f"{element_type} {idx}: OK")
            except Exception as e:
                results.append(f"{element_type} {idx}: FAILED - {str(e)}")

        return [TextContent(type="text", text=f"Builds applied to slide {slide_number}:\n" + "\n".join(results))]