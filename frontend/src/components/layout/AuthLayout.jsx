import React from 'react';
import { Brand } from '../common';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

export default function AuthLayout({ children, reverse = false, backgroundImage }) {
  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 relative overflow-hidden">
      {/* Background Image with Overlay */}
      {backgroundImage && (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${backgroundImage})`,
          }}
        />
      )}
      {/* Dark Overlay for Better Readability - More opaque when backgroundImage is present */}
      <div className="absolute inset-0 bg-white/90 backdrop-blur-sm" />

      {/* Subtle Background Blobs */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-50 rounded-full blur-[120px]"
      />
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-100/50 rounded-full blur-[120px]"
      />

      {/* Mobile Branding (Always at top, outside the card) */}
      <div className="lg:hidden mb-8 text-center animate-fade-in w-full max-w-[280px] z-20">
        <Brand logoSize="md" className="!text-blue-700" />
        <div className="mt-4 h-px w-16 mx-auto bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
      </div>

      <motion.div
        layout
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-5xl lg:grid lg:grid-cols-2 gap-0 bg-white rounded-[2.5rem] lg:rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.06)] overflow-hidden border border-gray-100 relative z-10"
      >
        {/* Branding Column (Desktop Only Glassmorphic) */}
        <motion.div
          layout
          className={clsx(
            "relative hidden lg:flex flex-col items-center justify-center p-12 overflow-hidden",
            reverse ? "order-last border-l border-gray-50" : "order-first border-r border-gray-50"
          )}
        >
          {/* Decorative Elements */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-800" />
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
            className="absolute top-0 left-0 w-full h-full opacity-10 bg-[radial-gradient(circle_at_50%_50%,#fff_0%,transparent_70%)]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            key={reverse ? 'signup-brand' : 'login-brand'}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="relative z-10 text-center w-full"
          >
            <div className="bg-white/10 backdrop-blur-md rounded-[3rem] p-14 border border-white/20 shadow-2xl">
              <Brand className="!text-white" showSubtitle={true} logoSize="lg" />
            </div>
          </motion.div>
        </motion.div>

        {/* Form Column */}
        <motion.div
          layout
          className="p-8 sm:p-12 lg:p-16 flex flex-col justify-center bg-white"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={reverse ? 'signup-form' : 'login-form'}
              initial={{ opacity: 0, x: reverse ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reverse ? -20 : 20 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}
