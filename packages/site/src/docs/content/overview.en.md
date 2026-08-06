# Overview

Anybox is an open-source desktop AI agent workspace for software development and everyday work. It keeps project files, sessions, models, tools, and permissions together so an agent can advance real tasks instead of only answering questions.

## Core Capabilities

- **Software development:** understand code, locate problems, edit files, and run tests.
- **Research and office work:** organize sources, compare options, analyze data, and produce documents.
- **Content creation:** draft copy, scripts, pages, and execution plans.

Available capabilities depend on the operating system, active workspace, selected model, and enabled tools, MCP connections, and plugins.

## How It Works

| Concept | Purpose |
| --- | --- |
| Project | Sets the file directory and working boundary |
| Session | Preserves one collaboration and its execution record |
| Model | Interprets the goal and chooses the next step |
| Tool | Reads, searches, executes, or modifies |
| Permission | Asks, allows, or blocks when required |
| Skill / plugin | Adds reusable workflows and capabilities |

## Get Started

1. Open a local folder or Git repository.
2. Connect a provider in Settings and select a model.
3. Create a session and state the goal, scope, and completion criteria.
4. Review tool calls, file changes, and verification results.

Begin with a read-only request:

> Read the README and directory structure, explain how the project runs, and do not modify files yet.

## Data and Permissions

Opening a project does not authorize every operation. Tool availability, agent policy, session restrictions, and call-level approval jointly determine whether an action can run.

Cloud models, remote MCP servers, and connectors may receive task-relevant data. Never place API keys, tokens, passwords, or other secrets in sessions, project files, Skills, or plugins.
