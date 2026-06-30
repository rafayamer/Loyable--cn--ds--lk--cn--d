// ================================================================
//  Motion primitives (framer-motion) shared across surfaces.
//  All respect prefers-reduced-motion: when reduced, they render
//  statically with no transform/opacity animation.
//  Uses LazyMotion + domAnimation to keep the bundle light (import `m`).
// ================================================================
import React from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion, type Variants } from 'framer-motion';

export { LazyMotion, domAnimation, m, useReducedMotion };

const EASE = [0.16, 1, 0.3, 1] as const;

// Wrap the whole site once so `m.*` components work with the lazy feature set.
export const MotionProvider = ({ children }: { children: React.ReactNode }) => (
  <LazyMotion features={domAnimation} strict>{children}</LazyMotion>
);

// Fade + rise in on mount, with optional delay.
export const FadeIn = ({ children, delay = 0, y = 16, className, style }: {
  children: React.ReactNode; delay?: number; y?: number; className?: string; style?: React.CSSProperties;
}) => {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >{children}</m.div>
  );
};

// Reveal on scroll into view (once).
export const ScrollReveal = ({ children, delay = 0, y = 24, className, style }: {
  children: React.ReactNode; delay?: number; y?: number; className?: string; style?: React.CSSProperties;
}) => {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >{children}</m.div>
  );
};

// Stagger container + item for grids/lists.
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

export const Stagger = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      style={style}
      variants={reduce ? undefined : staggerParent}
      initial={reduce ? false : 'hidden'}
      whileInView={reduce ? undefined : 'show'}
      viewport={{ once: true, margin: '-40px' }}
    >{children}</m.div>
  );
};
export const StaggerItem = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
  const reduce = useReducedMotion();
  return <m.div className={className} style={style} variants={reduce ? undefined : staggerItem}>{children}</m.div>;
};

// Spring hover lift for cards/CTAs.
export const hoverLift = {
  whileHover: { y: -4, scale: 1.015, transition: { type: 'spring' as const, stiffness: 300, damping: 20 } },
  whileTap: { scale: 0.985 },
};

// Page-transition variants for AnimatePresence (route changes).
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.25, ease: EASE } },
};
