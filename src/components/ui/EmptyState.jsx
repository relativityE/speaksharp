import React from 'react';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';

export const EmptyState = ({ title, description }) => {
  return (
    <motion.div
      className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-border rounded-lg bg-card/50"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-xl font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </motion.div>
  );
};
