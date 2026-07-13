# EBINA UPDATE editing rules

- Change only the files and behavior explicitly requested by the user.
- Do not refactor, reformat, rename, redesign, or clean up unrelated code.
- Preserve existing content, data, assets, routes, and visual behavior unless the user explicitly requests a change.
- Before editing, inspect the Git status and preserve any existing user changes.
- Keep each requested correction in a small, focused commit so it can be reverted independently.
- After editing, inspect the diff, run checks proportional to the change, and report every changed file.
- Never discard, overwrite, or reset unrelated changes.
- Ask before any destructive action or any change to stored data or schemas.
