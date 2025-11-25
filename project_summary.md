# Project Overview: Commands Video Interaction

## Architecture
A full-stack interactive educational application combining a Django backend for data management/logging with a rich React frontend powered by computer vision (MediaPipe) and conversational AI (ElevenLabs).

### Backend (`/backend`)
- **Framework**: Django 5.2.8 + Django REST Framework.
- **Database**: SQLite (default).
- **Apps**:
  - `actions`: Manages "Activities" (commands like Clap, Wave).
  - `monitor`: Logs user interactions and events (Gestures, Face Detection, Session info).
- **API Endpoints**:
  - `GET /api/activities/`: Fetch available commands.
  - `POST /monitor/save-event/`: Log events from the frontend.

### Frontend (`/frontend/commands_frontend`)
- **Framework**: React 19 + Vite.
- **Key Libraries**:
  - `@elevenlabs/react`: Conversational AI agent ("Blizz").
  - `@mediapipe/holistic`, `@mediapipe/face_detection`: Real-time computer vision in the browser.
  - `react-router-dom`: Navigation.
- **Main Component**: `WarmUpSessionCommands.jsx`
  - **Logic**: Handles the game state machine (WARMUP -> PART_A -> PART_B -> PART_C).
  - **Vision**: Processes video feed to detect:
    - **Wave**: Hand movement analysis.
    - **Clap**: Wrist distance calculation.
    - **Nose Touch**: Index finger to nose distance.
    - **Raise Hand**: Wrist position relative to nose.
  - **AI Interaction**: The ElevenLabs agent guides the user, asks questions, and reacts to "signals" sent by the frontend (e.g., `[STUDENT_CLAPPED]`).

## Game Flow
1.  **Warmup**: Physical exercises (Clap, Wave, Touch Nose) verified by MediaPipe.
2.  **Part A (Snowball)**: Verbal identification of "Bossy Verbs".
3.  **Part B (Quiz)**: Identifying commands in a list of sentences.
4.  **Part C (Punctuation)**: Advanced command identification without punctuation cues.

## Key Files
- `backend/commands_backend/settings.py`: Django configuration.
- `backend/monitor/models.py`: Event logging schema.
- `frontend/commands_frontend/src/components/pages/WarmUpSessionCommands.jsx`: Core game logic and CV implementation.
