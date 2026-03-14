/**
 * Centralized CI and Testing configuration
 * Consistent across Orchestrator and Test Runners
 */
export const CI_CONFIG = {
    // Hard cap for workers to prevent STT resource oversubscription
    MAX_WORKERS: 4,
    // Scaling ratio based on available CPU cores
    WORKER_SCALING_RATIO: 0.75
};
