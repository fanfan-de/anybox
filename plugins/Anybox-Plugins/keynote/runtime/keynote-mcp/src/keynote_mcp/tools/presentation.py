"""
Presentation management tools
"""

from typing import Any, Dict, List, Optional
from mcp.types import Tool, TextContent
from ..utils import AppleScriptRunner, validate_file_path, KeynoteError


class PresentationTools:
    """Presentation management tools class"""
    
    def __init__(self):
        self.runner = AppleScriptRunner()
    
    def get_tools(self) -> List[Tool]:
        """Get all presentation management tools"""
        return [
            Tool(
                name="create_presentation",
                description="Create a new Keynote presentation",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Presentation title"
                        },
                        "theme": {
                            "type": "string",
                            "description": "Theme name (optional)"
                        },
                        "template": {
                            "type": "string",
                            "description": "Template path (optional)"
                        }
                    },
                    "required": ["title"]
                }
            ),
            Tool(
                name="open_presentation",
                description="Open an existing Keynote presentation",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Path to the presentation file"
                        }
                    },
                    "required": ["file_path"]
                }
            ),
            Tool(
                name="save_presentation",
                description="Save a presentation",
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
                name="close_presentation",
                description="Close a presentation",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "should_save": {
                            "type": "boolean",
                            "description": "Whether to save before closing (default: true)"
                        }
                    }
                }
            ),
            Tool(
                name="list_presentations",
                description="List all open presentations",
                inputSchema={
                    "type": "object",
                    "properties": {}
                }
            ),
            Tool(
                name="set_presentation_theme",
                description="Set presentation theme",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "doc_name": {
                            "type": "string",
                            "description": "Document name (optional, defaults to front document)"
                        },
                        "theme_name": {
                            "type": "string",
                            "description": "Theme name"
                        }
                    },
                    "required": ["theme_name"]
                }
            ),
            Tool(
                name="get_presentation_info",
                description="Get presentation info (name, slide count, theme)",
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
                name="get_available_themes",
                description="Get list of available themes",
                inputSchema={
                    "type": "object",
                    "properties": {}
                }
            ),
            Tool(
                name="get_presentation_resolution",
                description="Get presentation resolution (width, height, aspect ratio)",
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
                name="get_slide_size",
                description="Get slide size, aspect ratio, and layout reference info",
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
    
    async def create_presentation(self, title: str, theme: str = "", template: str = "") -> List[TextContent]:
        """Create a new presentation"""
        try:
            # Ensure Keynote is running
            if not self.runner.check_keynote_running():
                self.runner.launch_keynote()

            # Create presentation
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    set newDoc to make new document
                    
                    if "{theme}" is not "" then
                        try
                            set theme of newDoc to theme "{theme}"
                        on error
                            log "Theme {theme} not found, using default theme"
                        end try
                    end if

                    set layout to "Blank"
                    
                    -- If a title is specified, save to Desktop
                    if "{title}" is not "" then
                        set desktopPath to (path to desktop as string) & "{title}.key"
                        save newDoc in file desktopPath
                    end if
                    
                    return name of newDoc
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Created presentation: {result}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to create presentation: {str(e)}"
            )]
    
    async def open_presentation(self, file_path: str) -> List[TextContent]:
        """Open a presentation"""
        try:
            validate_file_path(file_path)
            
            # Ensure Keynote is running
            if not self.runner.check_keynote_running():
                self.runner.launch_keynote()

            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    set targetFile to POSIX file "{file_path}"
                    open targetFile
                    return name of front document
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Opened presentation: {result}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to open presentation: {str(e)}"
            )]
    
    async def save_presentation(self, doc_name: str = "") -> List[TextContent]:
        """Save a presentation"""
        try:
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        save front document
                        return name of front document
                    else
                        save document "{doc_name}"
                        return "{doc_name}"
                    end if
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Saved presentation: {result}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to save presentation: {str(e)}"
            )]
    
    async def close_presentation(self, doc_name: str = "", should_save: bool = True) -> List[TextContent]:
        """Close a presentation"""
        try:
            save_flag = "true" if should_save else "false"
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    set docName to name of targetDoc
                    
                    if {save_flag} then
                        save targetDoc
                    end if
                    
                    close targetDoc
                    return docName
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"✅ Closed presentation: {result}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to close presentation: {str(e)}"
            )]
    
    async def list_presentations(self) -> List[TextContent]:
        """List all open presentations"""
        try:
            result = self.runner.run_inline_script('''
                tell application "Keynote"
                    set docList to {}
                    repeat with doc in documents
                        set end of docList to name of doc
                    end repeat
                    return docList as string
                end tell
            ''')
            
            if result:
                presentations = result.replace("{", "").replace("}", "").split(", ")
                presentation_list = "\n".join([f"• {name}" for name in presentations])
                return [TextContent(
                    type="text",
                    text=f"📋 Open presentations:\n{presentation_list}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text="📋 No open presentations"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to list presentations: {str(e)}"
            )]
    
    async def set_presentation_theme(self, theme_name: str, doc_name: str = "") -> List[TextContent]:
        """Set presentation theme"""
        try:
            # Use Keynote 14 compatible theme setting method
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    -- First check if the theme exists
                    set themeExists to false
                    repeat with t in themes
                        if name of t is "{theme_name}" then
                            set themeExists to true
                            exit repeat
                        end if
                    end repeat
                    
                    if not themeExists then
                        return "theme_not_found"
                    end if
                    
                    -- Set theme using document theme property
                    try
                        set document theme of targetDoc to theme "{theme_name}"
                        return "success"
                    on error errMsg
                        return "error: " & errMsg
                    end try
                end tell
            ''')
            
            if result == "success":
                return [TextContent(
                    type="text",
                    text=f"✅ Theme set: {theme_name}"
                )]
            elif result == "theme_not_found":
                return [TextContent(
                    type="text",
                    text=f"❌ Theme not found: {theme_name}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"❌ Failed to set theme: {result}"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to set theme: {str(e)}"
            )]
    
    async def get_presentation_info(self, doc_name: str = "") -> List[TextContent]:
        """Get presentation info"""
        try:
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    set docInfo to {{}}
                    set end of docInfo to name of targetDoc
                    set end of docInfo to count of slides of targetDoc
                    
                    try
                        set end of docInfo to name of theme of targetDoc
                    on error
                        set end of docInfo to "Unknown Theme"
                    end try
                    
                    return docInfo as string
                end tell
            ''')
            
            info_parts = result.replace("{", "").replace("}", "").split(", ")
            if len(info_parts) >= 3:
                name, slide_count, theme = info_parts[0], info_parts[1], info_parts[2]
                return [TextContent(
                    type="text",
                    text=f"📊 Presentation info:\n• Name: {name}\n• Slide count: {slide_count}\n• Theme: {theme}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"📊 Presentation info: {result}"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get presentation info: {str(e)}"
            )]
    
    async def get_available_themes(self) -> List[TextContent]:
        """Get list of available themes"""
        try:
            # Use a better delimiter for the theme list
            result = self.runner.run_inline_script('''
                tell application "Keynote"
                    set themeList to {}
                    repeat with t in themes
                        set end of themeList to name of t
                    end repeat
                    
                    set AppleScript's text item delimiters to "|||"
                    set themeString to themeList as string
                    set AppleScript's text item delimiters to ""
                    
                    return themeString
                end tell
            ''')
            
            if result:
                themes = result.split("|||")
                theme_list = "\n".join([f"• {theme}" for theme in themes if theme.strip()])
                return [TextContent(
                    type="text",
                    text=f"🎨 Available themes ({len(themes)}):\n{theme_list}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text="🎨 No available themes found"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get theme list: {str(e)}"
            )]
    
    async def get_presentation_resolution(self, doc_name: str = "") -> List[TextContent]:
        """Get presentation resolution"""
        try:
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    try
                        set docWidth to width of targetDoc
                        set docHeight to height of targetDoc
                        
                        set AppleScript's text item delimiters to ","
                        set resolution to {{docWidth, docHeight}} as string
                        set AppleScript's text item delimiters to ""
                        
                        return resolution
                    on error
                        -- Return standard 16:9 resolution
                        return "1920,1080"
                    end try
                end tell
            ''')
            
            # Parse result
            resolution_parts = result.split(",")
            if len(resolution_parts) >= 2:
                width, height = resolution_parts[0], resolution_parts[1]
                aspect_ratio = round(float(width) / float(height), 3)
                
                # Determine aspect ratio type
                if 1.7 < aspect_ratio < 1.8:
                    ratio_type = "16:9"
                elif 1.3 < aspect_ratio < 1.4:
                    ratio_type = "4:3"
                else:
                    ratio_type = "Custom"
                
                return [TextContent(
                    type="text",
                    text=f"📐 Presentation resolution:\n• Width: {width} px\n• Height: {height} px\n• Ratio: {aspect_ratio} ({ratio_type})"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"📐 Resolution info: {result}"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get resolution: {str(e)}"
            )]
    
    async def get_slide_size(self, doc_name: str = "") -> List[TextContent]:
        """Get slide size and aspect ratio info"""
        try:
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    if "{doc_name}" is "" then
                        set targetDoc to front document
                    else
                        set targetDoc to document "{doc_name}"
                    end if
                    
                    try
                        set slideWidth to width of targetDoc
                        set slideHeight to height of targetDoc
                        set aspectRatio to slideWidth / slideHeight
                        
                        -- Determine aspect ratio type
                        set ratioType to ""
                        if aspectRatio > 1.7 and aspectRatio < 1.8 then
                            set ratioType to "16:9"
                        else if aspectRatio > 1.3 and aspectRatio < 1.4 then
                            set ratioType to "4:3"
                        else
                            set ratioType to "Custom"
                        end if
                        
                        set AppleScript's text item delimiters to ","
                        set sizeInfo to {{slideWidth, slideHeight, aspectRatio, ratioType}} as string
                        set AppleScript's text item delimiters to ""
                        
                        return sizeInfo
                    on error
                        -- Return default values
                        return "1920,1080,1.777,16:9"
                    end try
                end tell
            ''')
            
            # Parse result
            size_parts = result.split(",")
            if len(size_parts) >= 4:
                width, height, ratio, ratio_type = size_parts[0], size_parts[1], size_parts[2], size_parts[3]
                
                # Calculate useful layout info
                width_num = float(width)
                height_num = float(height)
                
                # Calculate safe area (with margins)
                safe_width = int(width_num * 0.9)
                safe_height = int(height_num * 0.9)
                margin_x = int((width_num - safe_width) / 2)
                margin_y = int((height_num - safe_height) / 2)
                
                # Calculate common positions
                center_x = int(width_num / 2)
                center_y = int(height_num / 2)
                
                layout_info = f"""📏 Slide size info:
• Size: {width} x {height} px
• Ratio: {float(ratio):.3f} ({ratio_type})
• Center: ({center_x}, {center_y})

📐 Layout reference:
• Safe area: {safe_width} x {safe_height} px
• Margins: {margin_x} x {margin_y} px
• Suggested title area: y = {margin_y} - {margin_y + 100}
• Suggested content area: y = {margin_y + 120} - {safe_height + margin_y}"""
                
                return [TextContent(
                    type="text",
                    text=layout_info
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"📏 Size info: {result}"
                )]
                
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"❌ Failed to get slide size: {str(e)}"
            )] 