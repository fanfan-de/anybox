"""
AppleScript execution utilities for Keynote-MCP
"""

import subprocess
import os
import json
from typing import Any, Dict, List, Optional, Union
from pathlib import Path

from .error_handler import handle_applescript_error, AppleScriptError


class AppleScriptRunner:
    """AppleScript runner"""
    
    def __init__(self, script_dir: Optional[str] = None):
        """
        Initialize the AppleScript runner.

        Args:
            script_dir: Path to the AppleScript scripts directory
        """
        if script_dir is None:
            # Default scripts directory
            current_dir = Path(__file__).parent.parent
            script_dir = current_dir / "applescript"
        
        self.script_dir = Path(script_dir)
        self._ensure_script_dir()
    
    def _ensure_script_dir(self) -> None:
        """Ensure the scripts directory exists."""
        if not self.script_dir.exists():
            self.script_dir.mkdir(parents=True, exist_ok=True)
    
    def run_script(self, script_name: str, function_name: str, *args) -> str:
        """
        Run a specific function from an AppleScript file.

        Args:
            script_name: Script filename (without extension)
            function_name: Function name
            *args: Function arguments

        Returns:
            Script execution result

        Raises:
            AppleScriptError: Script execution error
        """
        script_path = self.script_dir / f"{script_name}.scpt"
        
        if not script_path.exists():
            raise AppleScriptError(f"Script file not found: {script_path}")
        
        # Build the AppleScript invocation command
        script_args = self._format_args(*args)
        applescript_code = f"""
        set scriptFile to "{script_path}"
        set scriptObj to load script POSIX file scriptFile
        tell scriptObj to {function_name}({script_args})
        """
        
        return self._execute_applescript(applescript_code)
    
    def run_inline_script(self, script_code: str) -> str:
        """
        Run inline AppleScript code.

        Args:
            script_code: AppleScript code

        Returns:
            Script execution result
        """
        return self._execute_applescript(script_code)
    
    def _execute_applescript(self, script_code: str) -> str:
        """
        Execute AppleScript code.

        Args:
            script_code: AppleScript code

        Returns:
            Execution result
        """
        try:
            # Execute AppleScript via osascript
            result = subprocess.run(
                ["osascript", "-e", script_code],
                capture_output=True,
                text=True,
                timeout=30  # 30s timeout
            )
            
            if result.returncode != 0:
                handle_applescript_error(result.stderr)
            
            return result.stdout.strip()
            
        except subprocess.TimeoutExpired:
            raise AppleScriptError("AppleScript execution timed out")
        except subprocess.SubprocessError as e:
            raise AppleScriptError(f"Failed to execute AppleScript: {e}")
    
    def _format_args(self, *args) -> str:
        """
        Format function arguments for AppleScript.

        Args:
            *args: Argument list

        Returns:
            Formatted argument string
        """
        formatted_args = []
        
        for arg in args:
            if arg is None:
                formatted_args.append('""')
            elif isinstance(arg, bool):
                formatted_args.append("true" if arg else "false")
            elif isinstance(arg, (int, float)):
                formatted_args.append(str(arg))
            elif isinstance(arg, str):
                # Escape quotes in the string
                escaped_arg = arg.replace('"', '\\"')
                formatted_args.append(f'"{escaped_arg}"')
            elif isinstance(arg, (list, tuple)):
                # Handle list arguments
                list_items = [self._format_single_arg(item) for item in arg]
                formatted_args.append(f"{{{', '.join(list_items)}}}")
            else:
                # Convert other types to string
                formatted_args.append(f'"{str(arg)}"')
        
        return ", ".join(formatted_args)
    
    def _format_single_arg(self, arg: Any) -> str:
        """Format a single argument."""
        if arg is None:
            return '""'
        elif isinstance(arg, bool):
            return "true" if arg else "false"
        elif isinstance(arg, (int, float)):
            return str(arg)
        elif isinstance(arg, str):
            escaped_arg = arg.replace('"', '\\"')
            return f'"{escaped_arg}"'
        else:
            return f'"{str(arg)}"'
    
    def check_keynote_running(self) -> bool:
        """Check if Keynote is running."""
        script = '''
        tell application "System Events"
            return (name of processes) contains "Keynote"
        end tell
        '''
        
        try:
            result = self._execute_applescript(script)
            return result.lower() == "true"
        except AppleScriptError:
            return False
    
    def launch_keynote(self) -> None:
        """Launch the Keynote application."""
        script = '''
        tell application "Keynote"
            activate
        end tell
        '''
        
        self._execute_applescript(script)
    
    def quit_keynote(self) -> None:
        """Quit the Keynote application."""
        script = '''
        tell application "Keynote"
            quit
        end tell
        '''
        
        self._execute_applescript(script)
    
    def get_keynote_version(self) -> str:
        """Get the Keynote version."""
        script = '''
        tell application "Keynote"
            return version
        end tell
        '''
        
        return self._execute_applescript(script)
    
    def compile_script(self, script_source: str, output_path: str) -> None:
        """
        Compile AppleScript source into a .scpt file.

        Args:
            script_source: AppleScript source code
            output_path: Output file path
        """
        try:
            # Compile the script via osacompile
            result = subprocess.run(
                ["osacompile", "-o", output_path],
                input=script_source,
                text=True,
                capture_output=True,
                timeout=10
            )
            
            if result.returncode != 0:
                raise AppleScriptError(f"Failed to compile script: {result.stderr}")
                
        except subprocess.TimeoutExpired:
            raise AppleScriptError("Script compilation timed out")
        except subprocess.SubprocessError as e:
            raise AppleScriptError(f"Failed to compile script: {e}")
    
    def list_available_scripts(self) -> List[str]:
        """List available script files."""
        if not self.script_dir.exists():
            return []
        
        scripts = []
        for script_file in self.script_dir.glob("*.scpt"):
            scripts.append(script_file.stem)
        
        return sorted(scripts) 