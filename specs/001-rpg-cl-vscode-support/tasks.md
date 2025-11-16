---

description: "Tasks for RPG/CL Development Support Tool for VS Code"
---

# Tasks: RPG/CL Development Support Tool for VS Code

**Input**: Design documents from `specs/001-rpg-cl-vscode-support/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Keep automated tests minimal, but add unit tests for JSON definition loading/validation and basic F4 prompter behavior, plus a few light integration tests.  
**Organization**: Tasks are organized per user story (US1, US3) so that each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks).  
- **[Story]**: Related user story (US1 or US3).  
- Descriptions should include concrete file paths where possible.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the VS Code extension project and prepare the basic structure.

- [X] T001 Create VS Code extension project scaffold in `vscode-extension/`  
- [X] T002 Add TypeScript and build tooling configuration in `vscode-extension/tsconfig.json` and `vscode-extension/package.json`  
- [X] T003 Register extension activation events and base commands in `vscode-extension/src/extension/extension.ts`  
- [X] T004 Configure language associations for `.rpgle` and `.clp` in `vscode-extension/package.json`  
- [X] T005 [P] Add initial test harness using `vscode-test` and Mocha in `vscode-extension/test/unit/` and `vscode-extension/test/integration/`  

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the core shared foundation that all user stories depend on.

- [X] T006 Implement RPG fixed-format and CL language identifiers and basic tokenization in `vscode-extension/src/language/registration.ts`  
- [X] T007 [P] Implement initial syntax highlighting rules for RPG fixed-format and CL in `vscode-extension/resources/language/rpg-fixed.tmLanguage.json` and `vscode-extension/resources/language/cl.tmLanguage.json`  
- [X] T008 Implement JSON prompter definition loader for RPG and CL in `vscode-extension/src/prompter/jsonDefinitions.ts`  
- [X] T009 [P] Define TypeScript interfaces for `PrompterDefinition` and `ParameterDefinition` matching `data-model.md` in `vscode-extension/src/prompter/types.ts`  
- [X] T010 Implement core diagnostic pipeline for RPG/CL (hook into VS Code diagnostics API) in `vscode-extension/src/language/diagnostics.ts`  
- [X] T011 [P] Implement helper for determining whether a document is in scope (only `.rpgle` and `.clp`) in `vscode-extension/src/utils/fileScope.ts`  
- [X] T012 Implement shared configuration loader for workspace-level settings in `vscode-extension/src/utils/workspaceConfig.ts`  

**Checkpoint**: Language registration, JSON definition loading, diagnostics, and scope detection all work so that user story implementation can proceed.

---

## Phase 3: User Story 1 - Edit existing RPG/CL code in VS Code (Priority: P1)

**Goal**: Allow developers to open existing fixed-format RPG and CL source in VS Code and edit it safely with column-aware display and basic syntax support.  
**Independent Test**: Follow the User Story 1 flow in `quickstart.md` to open, edit, and save existing files and verify that syntax errors are shown correctly.

### Implementation for User Story 1 (US1)

- [X] T013 [P] [US1] Wire RPG fixed-format and CL language configurations into VS Code via `vscode-extension/package.json` and `vscode-extension/src/language/registration.ts`  
- [X] T014 [P] [US1] Implement detailed RPG fixed-format column handling (specification columns, opcodes, fields) in `vscode-extension/src/language/rpgLayout.ts`  
- [X] T015 [US1] Enforce FR-031 editing rule for RPG line 4 (only columns 7+ editable by helpers) in `vscode-extension/src/language/rpgEditGuards.ts`  
- [X] T016 [P] [US1] Implement CL syntax structure parsing sufficient for highlighting and basic error detection in `vscode-extension/src/language/clParser.ts`  
- [X] T017 [US1] Integrate diagnostic pipeline with RPG/CL parsers to surface errors and warnings in `vscode-extension/src/language/diagnostics.ts`  
- [X] T018 [P] [US1] Implement Ctrl+/ comment toggle for RPG fixed-format, respecting fixed columns, in `vscode-extension/src/language/rpgCommentToggle.ts`  
- [X] T019 [US1] Implement Ctrl+/ comment toggle for CL, including multi-line commands, in `vscode-extension/src/language/clCommentToggle.ts`  
- [X] T020 [US1] Register Ctrl+/ keybinding for RPG/CL documents in `vscode-extension/package.json`  
- [X] T021 [P] [US1] Implement Tab-key navigation between fixed-format columns (keyword positions), inserting spaces when necessary in `vscode-extension/src/language/rpgTabNavigation.ts`  
- [X] T022 [US1] Implement visualization of shift-out / shift-in control codes for DBCS as `{` / `}` without modifying the underlying file contents in `vscode-extension/src/language/dbcsShiftMarkers.ts`  

**Checkpoint**: In `.rpgle` / `.clp` files, column-aware display, basic diagnostics, Ctrl+/ comment toggle, Tab navigation, and shift-out/shift-in visualization all work as specified.

---

## Phase 4: User Story 3 - F4 prompter and workflow alignment (Priority: P3)

**Goal**: Provide an F4-key prompter that gives a local editing experience aligned with existing AS400 workflows, without performing remote send/compile/debug operations.  
**Independent Test**: Follow the User Story 3 flow in `quickstart.md` to press F4 on RPG/CL source, open the prompter, and verify that JSON-driven input/validation/insertion works as expected.

### Implementation for User Story 3 (US3)

- [X] T023 [US3] Implement `F4` keybinding and command registration for RPG/CL documents in `vscode-extension/package.json` and `vscode-extension/src/extension/commands/showPrompter.ts`  
- [X] T024 [P] [US3] Implement selection logic that maps cursor position to the appropriate RPG specification or CL command/parameter in `vscode-extension/src/prompter/positionResolver.ts`  
- [X] T025 [P] [US3] Implement JSON-based prompter model and validation (matching `md/instructions.md` JSON definition requirements) in `vscode-extension/src/prompter/model.ts`  
- [X] T026 [P] [US3] Implement WebView-based prompter UI (HTML/CSS/JavaScript) with Esc to close, Tab/Shift+Tab to move between fields, and Enter to confirm in `vscode-extension/src/prompter/webview.ts`  
- [X] T027 [US3] Wire prompter model and JSON definitions into the WebView, including placeholder text, dropdowns for constrained values, and field grouping for multi-value parameters in `vscode-extension/src/prompter/binding.ts`  
- [X] T028 [US3] Implement insertion/update of RPG/CL source when the prompter is confirmed, preserving fixed-format columns and respecting FR-031 in `vscode-extension/src/prompter/applyChanges.ts`  
- [X] T029 [P] [US3] Implement support for CL commands continued with `+` at end-of-line, treating logical multi-line commands as a single unit for prompting and updates in `vscode-extension/src/language/clContinuation.ts`  
- [X] T030 [P] [US3] Implement help panel and F1 handling from the prompter (including clickable help icons) in `vscode-extension/src/prompter/help.ts`  
- [X] T031 [US3] Implement hidden-parameter visibility toggling and rules for parameters that already have values (cannot be hidden) in `vscode-extension/src/prompter/visibilityRules.ts`  

**Checkpoint**: The F4 prompter builds its UI from JSON definitions and round-trips changes back to RPG/CL source, while never executing remote operations such as send/compile.

---

## Phase 5: Polish, Documentation, and Validation

**Purpose**: Confirm behavior matches the specification and tidy up documentation and developer experience.

- [X] T032 Add or update `quickstart.md` scenarios to match implemented US1/US3 flows  
- [X] T033 [P] Add unit tests for JSON prompter model and validation rules in `vscode-extension/test/unit/prompterModel.test.ts`  
- [X] T034 [P] Add unit tests for RPG/CL comment toggle and Tab navigation behaviors in `vscode-extension/test/unit/editingBehaviors.test.ts`  
- [X] T035 Add minimal integration tests using `vscode-test` to open `.rpgle` / `.clp` files, trigger F4, and verify that the prompter opens and applies changes without errors in `vscode-extension/test/integration/f4Prompter.test.ts`  
- [X] T036 Review `spec.md`, `plan.md`, and `tasks.md` to ensure they match the implemented scope (no template-from-creation features, no remote debug support).  

**Final Checkpoint**: All US1 and US3 tasks are complete, and manual verification using `quickstart.md` scenarios confirms behavior matches the spec.

