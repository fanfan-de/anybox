"""
Slide management tools
"""

from typing import Any, Dict, List, Optional
from mcp.types import Tool, TextContent
from ..utils import AppleScriptRunner, validate_slide_number, ParameterError


class SlideTools:
    """Slide management tools class"""
    
    def __init__(self):
        self.runner = AppleScriptRunner()
    
    def get_tools(self) -> List[Tool]:
        """Get all slide management tools"""
        return [
            Tool(
                name="add_slide",
                description="Add a new slide to the presentation",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "position": {
                            "type": "integer",
                            "description": "Insert position (optional, 0 = append at end)"
                        },
                        "layout": {
                            "type": "string",
                            "description": "Layout type (optional)"
                        }
                    }
                }
            ),
            Tool(
                name="delete_slide",
                description="Delete a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number to delete"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="duplicate_slide",
                description="Duplicate a slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number to duplicate"
                        },
                        "new_position": {
                            "type": "integer",
                            "description": "New position (optional, 0 = append at end)"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="move_slide",
                description="Move a slide to a different position",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "from_position": {
                            "type": "integer",
                            "description": "Source position"
                        },
                        "to_position": {
                            "type": "integer",
                            "description": "Target position"
                        }
                    },
                    "required": ["from_position", "to_position"]
                }
            ),
            Tool(
                name="get_slide_count",
                description="Get slide count",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    }
                }
            ),
            Tool(
                name="select_slide",
                description="Select a specific slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="set_slide_layout",
                description="Set slide layout",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "layout": {
                            "type": "string",
                            "description": "Layout type"
                        }
                    },
                    "required": ["slide_number", "layout"]
                }
            ),
            Tool(
                name="get_slide_info",
                description="Get slide info (number, layout, text item count)",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        }
                    },
                    "required": ["slide_number"]
                }
            ),
            Tool(
                name="get_available_layouts",
                description="Get list of available slide layouts",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        }
                    }
                }
            )
        ]
    
    async def add_slide(self, doc_name: str = "", position: int = 0, layout: str = "", clear_default_content: bool = True) -> List[TextContent]:
        """Add a new slide"""
        try:
            # If clearing default content is enabled and no layout specified, use Blank layout
            if clear_default_content and layout == "":
                layout = "Blank"
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    if {position} is 0 then
                        set newSlide to make new slide at end of slides of targetDoc
                    else
                        set newSlide to make new slide at slide {position} of targetDoc
                    end if
                    
                    if "{layout}" is not "" then
                        try
                            set base slide of newSlide to master slide "{layout}" of targetDoc
                        on error
                            -- If layout not found, try using Blank layout
                            try
                                set base slide of newSlide to master slide "Blank" of targetDoc
                                log "Layout {layout} not found, using Blank layout"
                            on error
                                log "Neither {layout} nor Blank layout found, using default layout"
                            end try
                        end try
                    end if
                    
                    return slide number of newSlide
                end tell
            ''')
            
            layout_info = f" (layout: {layout})" if layout else " (default layout)"
            return [TextContent(
                type="text",
                text=f"✅ Added slide #{result}{layout_info}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to add slide: {str(e)}"
            )]
    
    async def delete_slide(self, slide_number: int, doc_name: str = "") -> List[TextContent]:
        """Delete a slide"""
        try:
            validate_slide_number(slide_number)
            
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    delete slide {slide_number} of targetDoc
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Deleted slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to delete slide: {str(e)}"
            )]
    
    async def duplicate_slide(self, slide_number: int, doc_name: str = "", new_position: int = 0) -> List[TextContent]:
        """Duplicate a slide"""
        try:
            validate_slide_number(slide_number)
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if

                    tell targetDoc
                        set sourceSlide to slide {slide_number}
                        if {new_position} is 0 then
                            -- Duplicate right after the source slide
                            duplicate sourceSlide to after sourceSlide
                            set newSlideNum to {slide_number} + 1
                        else if {new_position} > {slide_number} then
                            duplicate sourceSlide to after slide {new_position} of targetDoc
                            set newSlideNum to {new_position} + 1
                        else
                            duplicate sourceSlide to before slide {new_position} of targetDoc
                            set newSlideNum to {new_position}
                        end if
                    end tell

                    return newSlideNum
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Duplicated slide, new number: {result}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to duplicate slide: {str(e)}"
            )]
    
    async def move_slide(self, from_position: int, to_position: int, doc_name: str = "") -> List[TextContent]:
        """Move a slide to a different position"""
        try:
            validate_slide_number(from_position)
            validate_slide_number(to_position)

            if from_position == to_position:
                return [TextContent(
                    type="text",
                    text=f"✅ Slide already at position {to_position}"
                )]

            # Use 'before' when moving backward, 'after' when moving forward.
            # Plain 'move X to slide Y' REPLACES slide Y, destroying it.
            if to_position < from_position:
                insert_ref = f"before slide {to_position}"
            else:
                insert_ref = f"after slide {to_position}"

            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if

                    move slide {from_position} of targetDoc to {insert_ref} of targetDoc
                end tell
            ''')

            return [TextContent(
                type="text",
                text=f"✅ Moved slide from position {from_position} to position {to_position}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to move slide: {str(e)}"
            )]
    
    async def get_slide_count(self, doc_name: str = "") -> List[TextContent]:
        """Get slide count"""
        try:
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    return count of slides of targetDoc
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"📊 Slide count: {result}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get slide count: {str(e)}"
            )]
    
    async def select_slide(self, slide_number: int, doc_name: str = "") -> List[TextContent]:
        """Select a specific slide"""
        try:
            validate_slide_number(slide_number)
            
            self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    set current slide of targetDoc to slide {slide_number} of targetDoc
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Selected slide {slide_number}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to select slide: {str(e)}"
            )]
    
    async def set_slide_layout(self, slide_number: int, layout: str, doc_name: str = "") -> List[TextContent]:
        """Set slide layout"""
        try:
            validate_slide_number(slide_number)
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    try
                        -- Find target layout
                        set targetLayout to missing value
                        repeat with masterSlide in master slides of targetDoc
                            if name of masterSlide is "{layout}" then
                                set targetLayout to masterSlide
                                exit repeat
                            end if
                        end repeat
                        
                        if targetLayout is missing value then
                            return "layout_not_found"
                        end if
                        
                        -- Set slide layout (using correct syntax: base slide)
                        set base slide of slide {slide_number} of targetDoc to targetLayout
                        return "success"
                    on error errMsg
                        return "error: " & errMsg
                    end try
                end tell
            ''')
            
            if result == "success":
                return [TextContent(
                    type="text",
                    text=f"✅ Set slide {slide_number} layout to: {layout}"
                )]
            elif result == "layout_not_found":
                return [TextContent(
                    type="text",
                    text=f"❌ Layout not found: {layout}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"❌ Failed to set layout: {result}"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to set slide layout: {str(e)}"
            )]
    
    async def get_slide_info(self, slide_number: int, doc_name: str = "") -> List[TextContent]:
        """Get slide info"""
        try:
            validate_slide_number(slide_number)
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    set targetSlide to slide {slide_number} of targetDoc
                    set slideInfo to {{}}
                    
                    set end of slideInfo to slide number of targetSlide
                    
                    try
                        set end of slideInfo to name of master slide of targetSlide
                    on error
                        set end of slideInfo to "Unknown Layout"
                    end try
                    
                    try
                        set end of slideInfo to count of text items of targetSlide
                    on error
                        set end of slideInfo to 0
                    end try
                    
                    return slideInfo as string
                end tell
            ''')
            
            info_parts = result.replace("{", "").replace("}", "").split(", ")
            if len(info_parts) >= 3:
                number, layout, text_count = info_parts[0], info_parts[1], info_parts[2]
                return [TextContent(
                    type="text",
                    text=f"📊 Slide {slide_number} info:\n• Number: {number}\n• Layout: {layout}\n• Text item count: {text_count}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"📊 Slide {slide_number} info: {result}"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get slide info: {str(e)}"
            )]
    
    async def get_available_layouts(self, doc_name: str = "") -> List[TextContent]:
        """Get available layouts"""
        try:
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    set layoutList to {{}}
                    repeat with masterSlide in master slides of targetDoc
                        set end of layoutList to name of masterSlide
                    end repeat
                    
                    -- Use special delimiter to avoid comma issues in layout names
                    set AppleScript's text item delimiters to "|||"
                    set layoutString to layoutList as string
                    set AppleScript's text item delimiters to ""
                    
                    return layoutString
                end tell
            ''')
            
            if result:
                layouts = result.split("|||")
                layout_list = "\n".join([f"• {layout.strip()}" for layout in layouts if layout.strip()])
                return [TextContent(
                    type="text",
                    text=f"📐 Available layouts:\n{layout_list}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text="📐 No available layouts found"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get layouts: {str(e)}"
            )] 