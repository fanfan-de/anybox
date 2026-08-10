# Local ComfyUI workflow provider

This provider contains no bundled model catalog, workflow profile, or
API-format generation template. It discovers saved user workflows from
ComfyUI's `workflows/` user-data directory and treats the official APP mode
`extra.linearData` input/output selection as the only public UI contract.

References:

- APP mode: https://docs.comfy.org/interface/app-mode
- Workflow API format:
  https://docs.comfy.org/development/api-development/workflow-api-format
- User-data routes:
  https://github.com/Comfy-Org/ComfyUI/blob/master/app/user_manager.py

Models and custom nodes remain user-managed ComfyUI dependencies. Anybox only
validates dependencies required by each discovered workflow.
