import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WarmUpSessionCommands from './components/pages/WarmUpSessionCommands';
import TaskCompleted from './components/pages/TaskCompleted';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WarmUpSessionCommands />} />
        {/* optional: dashboard route - same component for now */}
        <Route path="/dash" element={<WarmUpSessionCommands />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;