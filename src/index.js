import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';

// Игнорируем ошибки от расширений Chrome
const originalError = console.error;
console.error = (...args) => {
    if (args[0]?.includes('Unchecked runtime.lastError')) {
        return;
    }
    originalError.apply(console, args);
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);