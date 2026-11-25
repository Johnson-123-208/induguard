import axios from 'axios';
import type {
  ConditionResult,
  Alert,
  SimulatorStatus,
  SimulatorStartOptions,
} from '../types';

const API_BASE = (
  import.meta.env.VITE_API_URL || 'https://induguard-api.onrender.com'
).replace(/\/$/, '');

const client = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = {
  // Health
  getHealth: async () => {
    const res = await client.get<{ status: string; service: string }>('/health');
    return res.data;
  },

  // Machines
  getMachines: async () => {
    const res = await client.get<ConditionResult[]>('/api/machines');
    return res.data;
  },

  getMachine: async (machineId: string) => {
    const res = await client.get<ConditionResult>(`/api/machines/${machineId}`);
    return res.data;
  },

  getMachineHistory: async (machineId: string) => {
    const res = await client.get<ConditionResult[]>(`/api/machines/${machineId}/history`);
    return res.data;
  },

  // Alerts
  getAlerts: async () => {
    const res = await client.get<Alert[]>('/api/alerts');
    return res.data;
  },

  acknowledgeAlert: async (alertId: string) => {
    const res = await client.post<{ status: string; message: string; alert_id: string }>(
      `/api/alerts/${alertId}/acknowledge`
    );
    return res.data;
  },

  // Simulator Controls
  getSimulatorStatus: async () => {
    const res = await client.get<SimulatorStatus>('/api/simulator/status');
    return res.data;
  },

  startSimulator: async (options: SimulatorStartOptions = {}) => {
    const payload = {
      scenario: options.scenario || 'normal',
      machine_id: options.machine_id || 'M01',
      steps: options.steps ?? 0,
      interval: options.interval ?? 1.0,
    };
    const res = await client.post<SimulatorStatus>('/api/simulator/start', payload);
    return res.data;
  },

  stopSimulator: async () => {
    const res = await client.post<SimulatorStatus>('/api/simulator/stop');
    return res.data;
  },

  // Direct Telemetry Ingestion / Fault Injection Helper
  ingestTelemetry: async (telemetry: Record<string, any>) => {
    const res = await client.post<ConditionResult>('/api/telemetry', telemetry);
    return res.data;
  },

  // Alert Email Management
  getEmailSettings: async () => {
    const res = await client.get<{
      recipient_email: string;
      smtp_server: string;
      smtp_port: number;
      sender_email: string;
      has_password: boolean;
      enabled: boolean;
      last_sent?: any;
    }>('/api/alerts/email-settings');
    return res.data;
  },

  updateEmailSettings: async (recipientEmail: string) => {
    const res = await client.post<{ status: string; config: any }>('/api/alerts/email-settings', {
      recipient_email: recipientEmail,
    });
    return res.data;
  },

  sendTestAlertEmail: async () => {
    const res = await client.post<{ status: string; message: string }>('/api/alerts/test-email');
    return res.data;
  },

  // Authentication
  login: async (username: string, password: string) => {
    const res = await client.post<{ status: string; operator: any }>('/api/auth/login', {
      username,
      password,
    });
    return res.data;
  },

  register: async (username: string, password: string, name: string) => {
    const res = await client.post<{ status: string; operator: any }>('/api/auth/register', {
      username,
      password,
      name,
    });
    return res.data;
  },
};

export default api;
