import { useState } from 'react';
import { getToken } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import './App.css';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());

  return loggedIn ? (
    <Dashboard onLoggedOut={() => setLoggedIn(false)} />
  ) : (
    <Login onLoggedIn={() => setLoggedIn(true)} />
  );
}
