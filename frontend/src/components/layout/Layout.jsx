import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard, Users, FileText, LogOut, Menu, X,
  ChevronRight, ClipboardList, Shield, Hospital
} from 'lucide-react';
import clsx from 'clsx';
import logo from '../../assets/logo.webp';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'hod', 'pcc', 'nursing'] },
  { to: '/patients', icon: Users, label: 'Patients', roles: ['admin', 'hod', 'pcc', 'nursing'] },
  { to: '/documents', icon: FileText, label: 'Documents', roles: ['admin', 'hod', 'pcc', 'nursing'] },
  { to: '/users', icon: Shield, label: 'Users', roles: ['admin', 'hod'] },
  { to: '/my-activity', icon: ClipboardList, label: 'My Activity', roles: ['hod', 'pcc', 'nursing'] },
  { to: '/audit-logs', icon: ClipboardList, label: 'Audit Logs', roles: ['admin', 'hod'] },
];

const roleColors = {
  admin: 'bg-red-100 text-red-700',
  hod: 'bg-purple-100 text-purple-700',
  pcc: 'bg-blue-100 text-blue-700',
  nursing: 'bg-green-100 text-green-700',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const visibleNavItems = navItems.filter((item) => item.roles.includes(user?.role));

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div 
        className="flex items-center gap-3 px-4 pb-6 border-b border-blue-700"
        style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <img src={logo} alt="Logo" className="w-12 h-12 rounded-full object-contain flex-shrink-0 border-2 border-blue-400/30 p-0.5" />
        <div className="min-w-0">
          <h1 className="text-white font-black text-xl leading-none uppercase tracking-tighter whitespace-nowrap">
            JPHRC <span className="text-blue-300 font-medium text-xs tracking-widest ml-1 opacity-80">ROURKELA</span>
          </h1>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => (
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
                <item.icon className={clsx('flex-shrink-0', isActive ? 'text-blue-700' : 'text-blue-200 group-hover:text-white')} size={18} />
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

      {/* Mobile/Tablet Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-blue-800 flex flex-col z-10 shadow-2xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute right-4 p-1.5 rounded-md text-blue-200 hover:text-white hover:bg-blue-700"
              style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
            >
              <X size={18} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar (mobile/tablet) */}
        <header 
          className="lg:hidden flex items-center justify-between gap-3 px-4 pb-3 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Open menu"
            >
              <Menu size={20} className="text-gray-600" />
            </button>
            <div className="flex items-center gap-2">
              <img src={logo} alt="Logo" className="w-9 h-9 rounded-full object-contain border border-blue-100 p-0.5" />
              <div className="min-w-0">
                <h1 className="font-black text-blue-700 text-lg leading-none uppercase tracking-tighter whitespace-nowrap">
                  JPHRC <span className="text-blue-500 font-bold text-[10px] tracking-widest ml-0.5">ROURKELA</span>
                </h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('text-xs px-2 py-0.5 rounded-full font-semibold uppercase', roleColors[user?.role])}>
              {user?.role}
            </span>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              title="Logout"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main 
          className="flex-1 overflow-y-auto bg-gray-50"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="max-w-7xl mx-auto p-3 sm:p-4 lg:p-6 animate-fade-in">
            <Outlet />
          </div>
        </main>

        {/* Bottom Nav Bar (mobile/tablet only) */}
        <nav 
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] flex"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
                  isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} className={clsx('transition-colors', isActive ? 'text-blue-600' : 'text-gray-400')} />
                  <span className="text-[10px] leading-tight">{item.label}</span>
                  {isActive && <span className="w-1 h-1 bg-blue-600 rounded-full mt-0.5" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
