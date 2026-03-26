# SillyTavern Extension Notes

## Put this folder here

During development, keep it in your repository at:

```text
D:\Projects\narrative-engine\frontend-extension\
```

## Responsibility of the extension
- UI panels
- slash-command registration
- backend API calls
- presentation of state and errors
- refresh actions after committed turns

## Keep out of the extension
- canonical state mutations without backend confirmation
- full inventory truth
- spell slot truth
- scene archive truth

## First UI build
1. side panel container
2. Overview tab
3. Inventory tab
4. Scene tab
5. Quests tab
6. basic command result display
