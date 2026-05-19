import React from 'react';
import clsx from 'clsx';
import { Loader2, ChevronDown } from 'lucide-react';
import logo from '../../assets/logo.webp';

// ── Button ─────────────────────────────────────────────────────────────────────
export function Button({ children, variant = 'primary', size = 'md', loading, disabled, className, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 shadow-sm',
    secondary: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 focus:ring-gray-300 shadow-sm',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 shadow-sm',
    ghost: 'hover:bg-gray-100 text-gray-600 focus:ring-gray-300',
    success: 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 shadow-sm',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };

  return (
    <button
      className={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ children, variant = 'gray', size = 'sm' }) {
  const variants = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  const sizes = { xs: 'px-1.5 py-0.5 text-xs', sm: 'px-2 py-0.5 text-xs' };

  return (
    <span className={clsx('inline-flex items-center gap-1 font-semibold rounded-full uppercase tracking-wide', variants[variant], sizes[size])}>
      {children}
    </span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className, padding = true }) {
  return (
    <div className={clsx('bg-white rounded-xl border border-gray-100 shadow-card', padding && 'p-5', className)}>
      {children}
    </div>
  );
}

// ── Input (Updated with forwardRef) ───────────────────────────────────────────
export const Input = React.forwardRef(({ label, error, required, className, icon: Icon, ...props }, ref) => {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Icon size={15} />
          </div>
        )}
        <input
          ref={ref}
          className={clsx(
            'w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all outline-none',
            'focus:ring-2 focus:ring-blue-500 focus:border-transparent',
            error ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300',
            Icon && 'pl-9',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-red-600 flex items-center gap-1">{error}</p>}
    </div>
  );
});

Input.displayName = 'Input';

// ── Select (Updated with forwardRef) ───────────────────────────────────────────
export const Select = React.forwardRef(({ label, error, required, children, className, ...props }, ref) => {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          className={clsx(
            'w-full rounded-lg border px-3 py-2.5 pr-10 text-sm text-gray-900 transition-all outline-none bg-white appearance-none',
            'focus:ring-2 focus:ring-blue-500 focus:border-transparent',
            error ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300',
            className
          )}
          {...props}
        >
          {children}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
          <ChevronDown size={16} />
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
    </div>
  );
});

Select.displayName = 'Select';

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md', className }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return (
    <div className={clsx('border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin', sizes[size], className)} />
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
        {Icon && <Icon className="w-8 h-8 text-gray-400" />}
      </div>
      <h3 className="text-gray-700 font-semibold text-base mb-1">{title}</h3>
      {description && <p className="text-gray-400 text-sm max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Stats Card ────────────────────────────────────────────────────────────────
export function StatCard({ title, value, icon: Icon, color = 'blue', trend, className }) {
  const colors = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600', border: 'border-blue-100' },
    green: { bg: 'bg-green-50', icon: 'text-green-600', border: 'border-green-100' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-100' },
    red: { bg: 'bg-red-50', icon: 'text-red-600', border: 'border-red-100' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-100' },
  };
  const c = colors[color];

  return (
    <Card className={clsx('border flex flex-col justify-between h-full w-full', c.border, className)} padding={false}>
      <div className="p-3 sm:p-5 flex flex-col justify-between h-full min-h-[105px] sm:min-h-[125px]">
        {/* Top section: Title and Icon */}
        <div className="flex items-start justify-between gap-1.5 sm:gap-3">
          <p className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider min-h-[40px] sm:min-h-[36px] flex items-center leading-tight">
            {title}
          </p>
          <div className={clsx('w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm', c.bg)}>
            <Icon className={clsx('w-4 h-4 sm:w-5 sm:h-5', c.icon)} />
          </div>
        </div>
        
        {/* Bottom section: Value and Trend */}
        <div className="mt-3 sm:mt-4 flex flex-col justify-end">
          <p className="text-xl sm:text-2xl font-extrabold text-gray-800 leading-none">
            {value ?? '0'}
          </p>
          {trend ? (
            <p className="text-[10px] text-gray-400 mt-1 font-semibold flex items-center gap-1">
              {trend}
            </p>
          ) : (
            <div className="h-[15px]" />
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx(
        'relative bg-white w-full rounded-2xl shadow-2xl animate-slide-up',
        'max-h-[92vh] flex flex-col overflow-hidden',
        maxWidth
      )}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <h2 className="font-bold text-gray-800 text-base">{title}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
        )}
        {/* Children fill full remaining modal height so sticky footer works */}
        <div className="flex flex-col flex-1 min-h-0 h-full">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Brand ─────────────────────────────────────────────────────────────────────
export function Brand({ className, showSubtitle = true, logoSize = 'md' }) {
  const logoSizes = {
    sm: 'w-10 h-10',
    md: 'w-24 h-24',
    lg: 'w-32 h-32',
  };

  return (
    <div className={clsx('flex flex-col items-center text-center group cursor-default select-none', className)}>
      <div className={clsx(
        'bg-white rounded-full flex items-center justify-center mb-6 shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden transition-all duration-500 group-hover:scale-105 group-hover:rotate-3 ring-8 ring-white/30',
        logoSizes[logoSize]
      )}>
        <img src={logo} alt="Hospital Logo" className="w-full h-full object-cover rounded-full p-0.5" />
      </div>
      <div className="space-y-3">
        <div className="flex flex-col items-center">
          <h1 className="text-sm lg:text-base font-black leading-none uppercase tracking-[0.2em] text-inherit">
            JAIPRAKASH HOSPITAL
          </h1>
          <div className="flex items-center gap-4 w-full my-1">
            <div className="h-px flex-1 bg-current opacity-10" />
            <span className="text-xs lg:text-sm font-black opacity-60">&</span>
            <div className="h-px flex-1 bg-current opacity-10" />
          </div>
          <h1 className="text-sm lg:text-base font-black leading-none uppercase tracking-[0.2em] text-inherit">
            RESEARCH CENTRE
          </h1>
        </div>

        {showSubtitle && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <p className="text-[10px] font-black uppercase tracking-[0.4em] opacity-90 text-inherit">
              ROURKELA
            </p>
            <div className="h-0.5 w-16 bg-blue-500 rounded-full" />
            <p className="text-[9px] font-bold uppercase tracking-[0.15em] opacity-100 text-inherit whitespace-nowrap italic">
              "Quality Healthcare at Affordable Price"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={!pagination.hasPrevPage}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
        >
          Prev
        </button>
        <span className="px-3 py-1.5 text-gray-700 font-medium text-xs">{page}/{totalPages}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!pagination.hasNextPage}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
        >
          Next
        </button>
      </div>
    </div>
  );
}