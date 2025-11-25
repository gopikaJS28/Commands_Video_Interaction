# Implementation Plan - Voice Agent UI Refactor

Refactor the existing simple voice status UI in `WarmUpSessionCommands.jsx` into a dedicated, visually rich `VoiceAgentUI` component that mimics modern voice assistants (Siri/Google Assistant style).

## Proposed Changes

### Frontend Components

#### [NEW] `src/components/VoiceAgentUI.jsx`
- A new React component that visualizes the agent's state.
- **Props**:
  - `isSpeaking`: boolean
  - `isListening`: boolean (or implied if not speaking)
- **Visuals**:
  - **Speaking State**: Dynamic waveform or animated orb that reacts (simulated or real if audio data available, but simulated is safer for now).
  - **Listening State**: A glowing/pulsing orb or ring.
  - **Idle/Thinking**: A subtle breathing animation.

#### [NEW] `src/components/VoiceAgentUI.css`
- CSS animations for the orb/waveform.
- Gradients and glow effects to achieve the "Siri" look.

#### [MODIFY] `src/components/pages/WarmUpSessionCommands.jsx`
- Import `VoiceAgentUI`.
- Replace the existing `<div className="active-container">...</div>` block with `<VoiceAgentUI isSpeaking={isSpeaking} />`.

## Verification Plan

### Manual Verification
- Start the session.
- Verify the UI shows the "Listening" state (pulsing orb) when the user is expected to speak.
- Verify the UI switches to "Speaking" state (animated waveform/orb) when the agent is talking.
- Ensure it looks "premium" as requested.
