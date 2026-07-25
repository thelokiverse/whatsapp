import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken } from '../api';

export default function AppShell() {
  const navigate = useNavigate();

  function handleLogout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1>WhatsApp Flow</h1>
        <nav className="main-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/onboard" className={({ isActive }) => (isActive ? 'active' : '')}>
            Add Recipient
          </NavLink>
        </nav>
        <button className="link-button" onClick={handleLogout}>
          Log out
        </button>
      </header>
      <Outlet />
    </div>
  );
}
