#!/usr/bin/env python3
"""
Keynote-MCP Server
An MCP server for controlling Keynote via AppleScript
"""

import asyncio
import json
import sys
from typing import Any, Sequence

from mcp.server import Server
from mcp.types import (
    Tool,
    TextContent,
    ImageContent,
    EmbeddedResource,
)
from mcp.server.stdio import stdio_server

from .tools import PresentationTools, SlideTools, ContentTools, ExportTools, UnsplashTools
from .utils import KeynoteError, AppleScriptError, FileOperationError, ParameterError


class KeynoteMCPServer:
    """Keynote MCP Server"""
    
    def __init__(self):
        self.server = Server("keynote-mcp")
        self.presentation_tools = PresentationTools()
        self.slide_tools = SlideTools()
        self.content_tools = ContentTools()
        self.export_tools = ExportTools()
        try:
            self.unsplash_tools = UnsplashTools()
        except ParameterError as e:
            # stdout is reserved for MCP JSON-RPC messages. Keep optional-feature
            # diagnostics on stderr and ASCII-safe for non-UTF-8 host locales.
            print(f"Unsplash tools disabled: {e}", file=sys.stderr)
            self.unsplash_tools = None
        
        # Register handlers
        self._register_handlers()
    
    def _register_handlers(self):
        """Register MCP handlers"""
        
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List all available tools"""
            tools = []
            tools.extend(self.presentation_tools.get_tools())
            tools.extend(self.slide_tools.get_tools())
            tools.extend(self.content_tools.get_tools())
            tools.extend(self.export_tools.get_tools())
            if self.unsplash_tools:
                tools.extend(self.unsplash_tools.get_tools())
            return tools
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: dict[str, Any]) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
            """Call a tool"""
            try:
                # Presentation management tools
                if name == "create_presentation":
                    return await self.presentation_tools.create_presentation(
                        title=arguments["title"],
                        theme=arguments.get("theme", ""),
                        template=arguments.get("template", "")
                    )
                elif name == "open_presentation":
                    return await self.presentation_tools.open_presentation(
                        file_path=arguments["file_path"]
                    )
                elif name == "save_presentation":
                    return await self.presentation_tools.save_presentation(
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "close_presentation":
                    return await self.presentation_tools.close_presentation(
                        doc_name=arguments.get("doc_name", ""),
                        should_save=arguments.get("should_save", True)
                    )
                elif name == "list_presentations":
                    return await self.presentation_tools.list_presentations()
                elif name == "set_presentation_theme":
                    return await self.presentation_tools.set_presentation_theme(
                        theme_name=arguments["theme_name"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_presentation_info":
                    return await self.presentation_tools.get_presentation_info(
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_available_themes":
                    return await self.presentation_tools.get_available_themes()
                elif name == "get_presentation_resolution":
                    return await self.presentation_tools.get_presentation_resolution(
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_slide_size":
                    return await self.presentation_tools.get_slide_size(
                        doc_name=arguments.get("doc_name", "")
                    )
                
                # Slide operation tools
                elif name == "add_slide":
                    return await self.slide_tools.add_slide(
                        doc_name=arguments.get("doc_name", ""),
                        position=arguments.get("position", 0),
                        layout=arguments.get("layout", "")
                    )
                elif name == "delete_slide":
                    return await self.slide_tools.delete_slide(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "duplicate_slide":
                    return await self.slide_tools.duplicate_slide(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", ""),
                        new_position=arguments.get("new_position", 0)
                    )
                elif name == "move_slide":
                    return await self.slide_tools.move_slide(
                        from_position=arguments["from_position"],
                        to_position=arguments["to_position"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_slide_count":
                    return await self.slide_tools.get_slide_count(
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "select_slide":
                    return await self.slide_tools.select_slide(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "set_slide_layout":
                    return await self.slide_tools.set_slide_layout(
                        slide_number=arguments["slide_number"],
                        layout=arguments["layout"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_slide_info":
                    return await self.slide_tools.get_slide_info(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_available_layouts":
                    return await self.slide_tools.get_available_layouts(
                        doc_name=arguments.get("doc_name", "")
                    )
                
                # Content management tools
                elif name == "add_text_box":
                    return await self.content_tools.add_text_box(
                        slide_number=arguments["slide_number"],
                        text=arguments["text"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", ""),
                        color=arguments.get("color", "")
                    )
                elif name == "add_title":
                    return await self.content_tools.add_title(
                        slide_number=arguments["slide_number"],
                        title=arguments["title"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", "")
                    )
                elif name == "add_subtitle":
                    return await self.content_tools.add_subtitle(
                        slide_number=arguments["slide_number"],
                        subtitle=arguments["subtitle"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", "")
                    )
                elif name == "add_bullet_list":
                    return await self.content_tools.add_bullet_list(
                        slide_number=arguments["slide_number"],
                        items=arguments["items"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", "")
                    )
                elif name == "add_numbered_list":
                    return await self.content_tools.add_numbered_list(
                        slide_number=arguments["slide_number"],
                        items=arguments["items"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", "")
                    )
                elif name == "add_code_block":
                    return await self.content_tools.add_code_block(
                        slide_number=arguments["slide_number"],
                        code=arguments["code"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", ""),
                        color=arguments.get("color", "")
                    )
                elif name == "add_quote":
                    return await self.content_tools.add_quote(
                        slide_number=arguments["slide_number"],
                        quote=arguments["quote"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        font_size=arguments.get("font_size"),
                        font_name=arguments.get("font_name", "")
                    )
                elif name == "add_image":
                    return await self.content_tools.add_image(
                        slide_number=arguments["slide_number"],
                        image_path=arguments["image_path"],
                        x=arguments.get("x"),
                        y=arguments.get("y")
                    )
                elif name == "get_slide_content":
                    return await self.content_tools.get_slide_content(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "edit_text_item":
                    return await self.content_tools.edit_text_item(
                        slide_number=arguments["slide_number"],
                        item_index=arguments["item_index"],
                        new_text=arguments["new_text"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "delete_element":
                    return await self.content_tools.delete_element(
                        slide_number=arguments["slide_number"],
                        element_type=arguments["element_type"],
                        element_index=arguments["element_index"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "move_element":
                    return await self.content_tools.move_element(
                        slide_number=arguments["slide_number"],
                        element_type=arguments["element_type"],
                        element_index=arguments["element_index"],
                        x=arguments["x"],
                        y=arguments["y"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "resize_element":
                    return await self.content_tools.resize_element(
                        slide_number=arguments["slide_number"],
                        element_type=arguments["element_type"],
                        element_index=arguments["element_index"],
                        width=arguments["width"],
                        height=arguments["height"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "get_speaker_notes":
                    return await self.content_tools.get_speaker_notes(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "set_speaker_notes":
                    return await self.content_tools.set_speaker_notes(
                        slide_number=arguments["slide_number"],
                        notes=arguments["notes"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "clear_slide":
                    return await self.content_tools.clear_slide(
                        slide_number=arguments["slide_number"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "set_element_opacity":
                    return await self.content_tools.set_element_opacity(
                        slide_number=arguments["slide_number"],
                        element_type=arguments["element_type"],
                        element_index=arguments["element_index"],
                        opacity=arguments["opacity"],
                        doc_name=arguments.get("doc_name", "")
                    )
                elif name == "add_build_in":
                    return await self.content_tools.add_build_in(
                        slide_number=arguments["slide_number"],
                        element_type=arguments["element_type"],
                        element_index=arguments["element_index"],
                        effect=arguments.get("effect", "Appear"),
                        delivery=arguments.get("delivery", "By Paragraph")
                    )
                elif name == "remove_build_in":
                    return await self.content_tools.remove_build_in(
                        slide_number=arguments["slide_number"],
                        element_type=arguments["element_type"],
                        element_index=arguments["element_index"]
                    )
                elif name == "add_builds_to_slide":
                    return await self.content_tools.add_builds_to_slide(
                        slide_number=arguments["slide_number"],
                        element_indices=arguments["element_indices"],
                        element_type=arguments.get("element_type", "text"),
                        effect=arguments.get("effect", "Appear")
                    )
                elif name == "add_shape":
                    return await self.content_tools.add_shape(
                        slide_number=arguments["slide_number"],
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        width=arguments.get("width"),
                        height=arguments.get("height"),
                        opacity=arguments.get("opacity"),
                        doc_name=arguments.get("doc_name", "")
                    )

                # Export and screenshot tools
                elif name == "screenshot_slide":
                    return await self.export_tools.screenshot_slide(
                        slide_number=arguments["slide_number"],
                        output_path=arguments["output_path"],
                        format=arguments.get("format", "png")
                    )
                elif name == "export_pdf":
                    return await self.export_tools.export_pdf(
                        output_path=arguments["output_path"]
                    )
                # Unsplash image tools
                elif name == "search_unsplash_images":
                    if not self.unsplash_tools:
                        return [TextContent(
                            type="text",
                            text="❌ Unsplash tools not initialized. Please check the UNSPLASH_KEY environment variable."
                        )]
                    return await self.unsplash_tools.search_unsplash_images(
                        query=arguments["query"],
                        per_page=arguments.get("per_page", 10),
                        orientation=arguments.get("orientation"),
                        order_by=arguments.get("order_by", "relevant")
                    )
                elif name == "add_unsplash_image_to_slide":
                    if not self.unsplash_tools:
                        return [TextContent(
                            type="text",
                            text="❌ Unsplash tools not initialized. Please check the UNSPLASH_KEY environment variable."
                        )]
                    return await self.unsplash_tools.add_unsplash_image_to_slide(
                        slide_number=arguments["slide_number"],
                        query=arguments["query"],
                        image_index=arguments.get("image_index", 0),
                        orientation=arguments.get("orientation"),
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        width=arguments.get("width"),
                        height=arguments.get("height")
                    )
                elif name == "get_random_unsplash_image":
                    if not self.unsplash_tools:
                        return [TextContent(
                            type="text",
                            text="❌ Unsplash tools not initialized. Please check the UNSPLASH_KEY environment variable."
                        )]
                    return await self.unsplash_tools.get_random_unsplash_image(
                        slide_number=arguments["slide_number"],
                        query=arguments.get("query"),
                        orientation=arguments.get("orientation"),
                        x=arguments.get("x"),
                        y=arguments.get("y"),
                        width=arguments.get("width"),
                        height=arguments.get("height")
                    )
                
                else:
                    return [TextContent(
                        type="text",
                        text=f"❌ Unknown tool: {name}"
                    )]
                    
            except ParameterError as e:
                return [TextContent(
                    type="text",
                    text=f"❌ Parameter error: {str(e)}"
                )]
            except AppleScriptError as e:
                return [TextContent(
                    type="text",
                    text=f"❌ AppleScript error: {str(e)}"
                )]
            except FileOperationError as e:
                return [TextContent(
                    type="text",
                    text=f"❌ File operation error: {str(e)}"
                )]
            except KeynoteError as e:
                return [TextContent(
                    type="text",
                    text=f"❌ Keynote error: {str(e)}"
                )]
            except Exception as e:
                return [TextContent(
                    type="text",
                    text=f"❌ Unknown error: {str(e)}"
                )]
    
    async def run(self):
        """Start the server"""
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )


async def _async_main():
    """Async entry point."""
    server = KeynoteMCPServer()
    await server.run()


def main():
    """Sync entry point for console_scripts."""
    asyncio.run(_async_main())


if __name__ == "__main__":
    main() 
