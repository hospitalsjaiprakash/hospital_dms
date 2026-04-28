import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard, Users, FileText, LogOut, Menu, X,
  ChevronRight, ClipboardList, Shield, Hospital, Bell
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'hod', 'pcc'] },
  { to: '/patients', icon: Users, label: 'Patients', roles: ['admin', 'hod', 'pcc'] },
  { to: '/users', icon: Shield, label: 'User Management', roles: ['admin'] },
  { to: '/audit-logs', icon: ClipboardList, label: 'Audit Logs', roles: ['admin', 'hod'] },
];

const roleColors = {
  admin: 'bg-red-100 text-red-700',
  hod: 'bg-purple-100 text-purple-700',
  pcc: 'bg-blue-100 text-blue-700',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-blue-700">
        <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center flex-shrink-0">
          <Hospital className="w-5 h-5 text-blue-700" />
        </div>
        <div className="min-w-0">
          <h1 className="text-white font-bold text-sm leading-tight">Hospital DMS</h1>
          <p className="text-blue-200 text-xs truncate">Document Management</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems
          .filter((item) => item.roles.includes(user?.role))
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group',
                  isActive
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-blue-100 hover:bg-blue-700 hover:text-white'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={clsx('w-4.5 h-4.5 flex-shrink-0', isActive ? 'text-blue-700' : 'text-blue-200 group-hover:text-white')} size={18} />
                  <span>{item.label}</span>
                  {isActive && <ChevronRight className="ml-auto w-4 h-4 text-blue-400" />}
                </>
              )}
            </NavLink>
          ))}
      </nav>

      {/* User Info */}
      <div className="px-3 py-4 border-t border-blue-700">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-700">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0">
            <span className="text-blue-700 font-bold text-xs">{user?.name?.charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{user?.name}</p>
            <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium uppercase', roleColors[user?.role])}>
              {user?.role}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 hover:bg-blue-600 rounded-md transition-colors text-blue-200 hover:text-white"
            title="Logout"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-56 bg-blue-800 flex-col flex-shrink-0 shadow-xl">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 bg-blue-800 flex flex-col z-10 animate-slide-up">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-md text-blue-200 hover:text-white hover:bg-blue-700"
            >
              <X size={18} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar (mobile) */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Menu size={20} className="text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <Hospital className="w-5 h-5 text-blue-700" />
            <span className="font-bold text-gray-800 text-sm">Hospital DMS</span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 lg:p-6 animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
