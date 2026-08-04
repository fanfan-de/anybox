"""
Export and screenshot tools
"""

from typing import Any, Dict, List, Optional
from mcp.types import Tool, TextContent
from ..utils import AppleScriptRunner, validate_slide_number, validate_file_path, ParameterError


class ExportTools:
    """Export and screenshot tools class"""
    
    def __init__(self):
        self.runner = AppleScriptRunner()
    
    def get_tools(self) -> List[Tool]:
        """Get all export and screenshot tools"""
        return [
            Tool(
                name="screenshot_slide",
                description="Take a screenshot of a single slide",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "slide_number": {
                            "type": "integer",
                            "description": "Slide number"
                        },
                        "output_path": {
                            "type": "string",
                            "description": "Output file path"
                        },
                        "format": {
                            "type": "string",
                            "description": "Image format (png/jpg, default: png)"
                        }
                    },
                    "required": ["slide_number", "output_path"]
                }
            ),
            Tool(
                name="export_pdf",
                description="Export presentation as PDF",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "output_path": {
                            "type": "string",
                            "description": "Output file path"
                        }
                    },
                    "required": ["output_path"]
                }
            )
        ]
    
    async def screenshot_slide(self, slide_number: int, output_path: str, format: str = "png") -> List[TextContent]:
        """Take a screenshot of a single slide"""
        try:
            validate_slide_number(slide_number)
            validate_file_path(output_path)
            
            # Set export format
            export_format = "JPEG" if format.lower() in ["jpg", "jpeg"] else "PNG"
            
            # Get directory and filename from output path
            import os
            output_dir = os.path.dirname(output_path)
            output_filename = os.path.basename(output_path)
            
            # Create temporary export folder
            temp_folder = os.path.join(output_dir, "temp_keynote_export")
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    activate
                    set targetDoc to front document
                    set docName to name of targetDoc
                    
                    -- Skip all slides except the target slide
                    tell targetDoc
                        set skipped of every slide to true
                        set skipped of slide {slide_number} to false
                    end tell
                    
                    -- Create temporary export folder
                    tell application "Finder"
                        if not (exists folder "{temp_folder}") then
                            make new folder at (POSIX file "{output_dir}") with properties {{name:"temp_keynote_export"}}
                        end if
                    end tell
                    
                    -- Export slide as image to temporary folder
                    set outputFolder to POSIX file "{temp_folder}"
                    export targetDoc as slide images to outputFolder with properties {{image format:{export_format}, skipped slides:false}}
                    
                    -- Restore all slides
                    tell targetDoc
                        set skipped of every slide to false
                    end tell
                    
                    return "success"
                end tell
            ''')
            
            # Find generated file and rename to target filename
            import glob
            generated_files = glob.glob(os.path.join(temp_folder, f"*.{format.lower()}"))
            if generated_files:
                # Move the first file to the target location
                import shutil
                shutil.move(generated_files[0], output_path)
                
                # Clean up temporary folder
                shutil.rmtree(temp_folder, ignore_errors=True)
                
                return [TextContent(
                    type="text",
                    text=f"Successfully captured screenshot of slide {slide_number} to: {output_path}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"Screenshot file was not generated"
                )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"Failed to screenshot slide: {str(e)}"
            )]
    
    async def export_pdf(self, output_path: str) -> List[TextContent]:
        """Export presentation as PDF"""
        try:
            validate_file_path(output_path)
            
            result = self.runner.run_inline_script(f'''
                tell application "Keynote"
                    set targetDoc to front document
                    set outputFile to POSIX file "{output_path}"
                    
                    -- Export as PDF
                    export targetDoc to outputFile as PDF
                    
                    return "success"
                end tell
            ''')
            
            return [TextContent(
                type="text",
                text=f"Successfully exported PDF to: {output_path}"
            )]
            
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"Failed to export PDF: {str(e)}"
            )] 