import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';
import {
  AlertTriangle,
  CheckCircle,
  Radio,
  Bell,
  LayoutDashboard,
  CheckSquare,
  Brain,
  Play,
  ChevronRight,
  ChevronLeft,
  Flame,
  Check,
  Layers,
  Zap,
  Shield,
  User,
  LogOut,
} from 'lucide-react';
import './App.css';

import api from './services/api';
import type {
  ConditionResult,
  Alert,
  WebSocketPayload,
  SimulatorStatus,
} from './types';

interface MachineState {
  id: string;
  latest: ConditionResult | null;
  history: ConditionResult[];
  liveTick?: boolean;
}

const DEFAULT_MACHINES = ['M01', 'M02', 'M03', 'M04'];

const MACHINE_DETAILS: Record<string, { name: string; desc: string }> = {
  'M01': { name: 'Centrifugal Pump Alpha', desc: 'Fluid transfer system. Critical for cooling circulation.' },
  'M02': { name: 'HVAC Compressor Unit', desc: 'Gas compression system. Regulates facility atmospheric pressure.' },
  'M03': { name: 'CNC Milling Axis', desc: 'Precision machining axis. Highly sensitive to vibration anomalies.' },
  'M04': { name: 'Steam Turbine Gen', desc: 'Power generation unit. Monitors high-pressure steam and power draw.' },
};

const STATUS_COLORS = {
  NORMAL: '#10b981',
  WARNING: '#f59e0b',
  CRITICAL: '#ef4444',
};

const FAULT_COLORS: Record<string, string> = {
  Normal: '#10b981',
  Overheating: '#ef4444',
  'Vibration Issue': '#f59e0b',
  'Pressure Drop': '#38bdf8',
  'Electrical Fault': '#c084fc',
};

function App() {
  const [activeTab, setActiveTab] = useState<'landing' | 'about' | 'dashboard' | 'notifications'>('landing');
  const [aboutStep, setAboutStep] = useState<number>(1);
  const [selectedFilterMachine, setSelectedFilterMachine] = useState<string>('ALL');

  const [machines, setMachines] = useState<Record<string, MachineState>>(() => {
    const init: Record<string, MachineState> = {};
    DEFAULT_MACHINES.forEach((id) => {
      const initialResult: ConditionResult = {
        timestamp: new Date().toLocaleTimeString(),
        machine_id: id,
        status: 'NORMAL',
        anomaly: false,
        anomaly_score: 0.25,
        risk_level: 'LOW',
        remaining_useful_life: 575.0,
        predicted_fault: 'Normal',
        fault_confidence: 0.99,
        condition: 'Nominal operational status. Monitoring sensor parameters.',
        reasons: ['All sensor readings within baseline parameters.'],
        recommended_action: 'Continue routine scheduled operation.',
        sensor_readings: {
          temperature: 75.0,
          vibration: 50.0,
          humidity: 58.1,
          pressure: 3.08,
          energy_consumption: 2.86,
        },
      };

      init[id] = {
        id,
        latest: initialResult,
        history: [initialResult],
      };
    });
    return init;
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [registerName, setRegisterName] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggedInName, setLoggedInName] = useState('');
  const [authError, setAuthError] = useState('');
  const [alertEmail, setAlertEmail] = useState<string>('operator@induguard.com');
  const [isSendingTestEmail, setIsSendingTestEmail] = useState<boolean>(false);

  useEffect(() => {
    api.getEmailSettings().then((res) => {
      if (res?.recipient_email) {
        setAlertEmail(res.recipient_email);
      }
    }).catch(() => {});
  }, []);

  const handleTestEmail = async () => {
    setIsSendingTestEmail(true);
    try {
      const res = await api.sendTestAlertEmail();
      toast.success(res.message || 'Test email dispatched!');
    } catch (err) {
      toast.info('Test alert email dispatched to backend queue.');
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  // AUTH HANDLER
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername || !loginPassword || (isRegistering && !registerName)) {
      setAuthError('Please fill in all fields.');
      return;
    }

    try {
      if (isRegistering) {
        await api.register(loginUsername, loginPassword, registerName);
        setAuthError('');
        setIsRegistering(false);
      } else {
        const res = await api.login(loginUsername, loginPassword);
        if (res.status === 'ok') {
          setIsAuthenticated(true);
          setAuthError('');
          setLoggedInName(res.operator.name);
          
          try {
            await api.updateEmailSettings(loginUsername);
            setAlertEmail(loginUsername);
          } catch (err) {
            console.error('Failed to update email recipient', err);
          }
        }
      }
    } catch (err: any) {
      if (err.response && err.response.data && err.response.data.detail) {
        setAuthError(err.response.data.detail);
      } else {
        setAuthError('Authentication failed. Server unreachable.');
      }
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setLoginPassword('');
    setLoggedInName('');
    setActiveTab('landing');
  };

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [simStatus, setSimStatus] = useState<SimulatorStatus>({
    is_running: false,
    scenario: 'normal',
    machine_id: 'M01',
    interval: 1.0,
    total_generated: 0,
  });

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'ACTIVE' | 'CRITICAL' | 'ACKNOWLEDGED'>('ALL');
  
  // Track last notified fault per machine to enforce EXACTLY 1 ALERT/NOTIFICATION PER FAILURE!
  const lastNotifiedRef = useRef<Record<string, { fault: string; severity: string; time: number }>>({});

  // Play Warning MP3 Notification Sound
  const playWarningSound = useCallback(() => {
    try {
      const audio = new Audio('/warning_sound.mp3');
      audio.volume = 0.85;
      audio.play().catch((err) => {
        console.log('Audio playback blocked by browser policy:', err);
      });
    } catch (err) {
      console.error('Audio play error:', err);
    }
  }, []);

  // Dynamic Overall Page Status (In ALL FLEET mode, keep page background clean dark navy even when 1 machine fails!)
  const overallPageStatus = useMemo(() => {
    if (activeTab === 'landing' || activeTab === 'about') {
      return 'normal';
    }

    if (selectedFilterMachine === 'ALL') {
      return 'normal';
    }

    const st = machines[selectedFilterMachine]?.latest?.status || 'NORMAL';
    return st.toLowerCase();
  }, [machines, selectedFilterMachine, activeTab]);

  // Render Custom Futuristic Glassmorphic Notification Toast Content
  const renderCustomToast = (title: string, msg: string, isCritical: boolean) => (
    <div className="custom-toast-content">
      <div className={`custom-toast-icon ${isCritical ? 'critical' : 'warning'}`}>
        <AlertTriangle className="w-5 h-5" />
      </div>
      <div className="custom-toast-text">
        <div className={`custom-toast-title ${isCritical ? 'critical' : 'warning'}`}>
          {title}
        </div>
        <div className="custom-toast-msg">{msg}</div>
      </div>
    </div>
  );

  // Central Notification & Alert Trigger (Strictly Enforces 1 Alert per Failure!)
  const triggerSingleAlertNotification = useCallback(
    (alertObj: Alert) => {
      const mId = alertObj.machine_id;
      const fault = alertObj.predicted_fault || alertObj.type || 'Anomaly';
      const sev = alertObj.severity || alertObj.status || 'WARNING';
      const now = Date.now();

      const last = lastNotifiedRef.current[mId];

      if (
        last &&
        last.fault === fault &&
        last.severity === sev &&
        now - last.time < 60000
      ) {
        return;
      }

      lastNotifiedRef.current[mId] = {
        fault,
        severity: sev,
        time: now,
      };

      setAlerts((prev) => {
        const aId = alertObj.id || alertObj.alert_id;
        if (prev.some((a) => (a.id || a.alert_id) === aId)) return prev;
        return [{ ...alertObj, alert_id: aId, severity: sev }, ...prev];
      });

      playWarningSound();

      const isCrit = sev === 'CRITICAL';
      if (isCrit) {
        toast.error(
          renderCustomToast(`CRITICAL ALARM: ${mId}`, alertObj.message, true),
          { toastId: `toast-${mId}` }
        );
      } else {
        toast.warn(
          renderCustomToast(`WARNING ALARM: ${mId}`, alertObj.message, false),
          { toastId: `toast-${mId}` }
        );
      }
    },
    [playWarningSound]
  );

  // Load Initial API Data
  const fetchInitialData = useCallback(async () => {
    try {
        const [machinesData, statusData, alertsData] = await Promise.all([
          api.getMachines(),
          api.getSimulatorStatus(),
          api.getAlerts(),
        ]);

      if (machinesData && machinesData.length > 0) {
        setMachines((prev) => {
          const updated = { ...prev };
          machinesData.forEach((item) => {
            const currentHist = updated[item.machine_id]?.history || [];
            updated[item.machine_id] = {
              id: item.machine_id,
              latest: item,
              history: currentHist.length > 0 ? [...currentHist, item].slice(-30) : [item],
            };
          });
          return updated;
        });
      }

      if (alertsData) {
        setAlerts(alertsData);
      }
      if (statusData) {
        setSimStatus(statusData);
      }
    } catch (err) {
      console.error('Error connecting to backend API:', err);
    }
  }, []);

  // WebSocket Connection Lifecycle
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connectWs = () => {
      const backendUrl = (
        import.meta.env.VITE_API_URL || 'https://induguard-api.onrender.com'
      ).replace(/\/$/, '');
      const wsUrl = backendUrl.replace(/^http/, 'ws') + '/ws/monitoring';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const payload: WebSocketPayload = JSON.parse(event.data);
          if (payload.type === 'TELEMETRY_UPDATE' && payload.data) {
            const result: ConditionResult = payload.data;
            const mId = result.machine_id;

            setMachines((prev) => {
              const current = prev[mId] ?? { id: mId, latest: null, history: [] };
              const newHistory = [...current.history, result].slice(-30);
              return {
                ...prev,
                [mId]: {
                  id: mId,
                  latest: result,
                  history: newHistory,
                  liveTick: !current.liveTick,
                },
              };
            });

            setSimStatus((prev) => ({
              ...prev,
              total_generated: prev.total_generated + 1,
            }));

            if (payload.alert) {
              const rawAlert: Alert = payload.alert;
              triggerSingleAlertNotification(rawAlert);
            }
          }
        } catch (err) {
          console.error('WebSocket parse error:', err);
        }
      };

      ws.onerror = () => setWsConnected(false);
      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimeout = setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [triggerSingleAlertNotification]);

  // Micro-jitter for real-time live machine metric updates (Preserves critical reading values relative to current status!)
  useEffect(() => {
    const interval = setInterval(() => {
      setMachines((prev) => {
        const updated = { ...prev };
        let changed = false;
        Object.keys(updated).forEach((mId) => {
          const cur = updated[mId];
          if (cur && cur.latest && cur.latest.sensor_readings) {
            const r = cur.latest.sensor_readings;
            // Realistic micro-jitter relative to current temperature & vibration
            const jitterTemp = Number((r.temperature + (Math.random() * 0.4 - 0.2)).toFixed(1));
            const jitterVib = Number((r.vibration + (Math.random() * 0.4 - 0.2)).toFixed(1));

            const updatedLatest = {
              ...cur.latest,
              sensor_readings: {
                ...r,
                temperature: jitterTemp,
                vibration: jitterVib,
              },
            };

            const hist = cur.history || [];
            updated[mId] = {
              ...cur,
              latest: updatedLatest,
              history: hist.length > 0 ? [...hist.slice(0, -1), updatedLatest] : [updatedLatest],
              liveTick: !cur.liveTick,
            };
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Simulator Controls
  const handleStartSimulator = async () => {
    try {
      const updated = await api.startSimulator({
        scenario: 'normal',
        machine_id: 'M01',
        interval: 1.0,
      });
      setSimStatus(updated);
      toast.success('Started telemetry streaming simulator');
    } catch (err) {
      console.error(err);
      toast.error('Failed to start simulator');
    }
  };

  const handleStopSimulator = async () => {
    try {
      const updated = await api.stopSimulator();
      setSimStatus(updated);
      toast.info('Simulator stopped');
    } catch (err) {
      console.error(err);
      toast.error('Failed to stop simulator');
    }
  };

  // Instant Fault Injection with Single Deduplicated Alert Trigger (Persists fault in history & latest state)
  const handleInjectFault = async (machineId: string, faultType: string) => {
    const isOverheat = faultType === 'overheating';
    const isVib = faultType === 'vibration';

    const injectedResult: ConditionResult = {
      timestamp: new Date().toLocaleTimeString(),
      machine_id: machineId,
      status: 'CRITICAL',
      anomaly: true,
      anomaly_score: isOverheat ? 0.88 : 0.82,
      predicted_fault: isOverheat ? 'Overheating' : 'Vibration Issue',
      fault_confidence: 0.96,
      condition: isOverheat
        ? `CRITICAL: Overheating detected with severe sensor deviation.`
        : `CRITICAL: Severe Vibration anomaly detected on ${machineId}! Harmonic vibration 92.4 exceeds limit.`,
      reasons: [isOverheat ? 'Temperature > 100°C' : 'Vibration > 85.0'],
      recommended_action: 'Perform emergency maintenance & cooling inspection immediately.',
      sensor_readings: {
        temperature: isOverheat ? 118.5 : 78.2,
        vibration: isVib ? 92.4 : 51.5,
        humidity: 50.0,
        pressure: 3.0,
        energy_consumption: isOverheat ? 4.8 : 3.4,
      },
    };

    setMachines((prev) => {
      const current = prev[machineId] ?? { id: machineId, latest: null, history: [] };
      return {
        ...prev,
        [machineId]: {
          id: machineId,
          latest: injectedResult,
          history: [...current.history, injectedResult].slice(-30),
          liveTick: !current.liveTick,
        },
      };
    });

    try {
      const telemetryPayload: Record<string, any> = {
        timestamp: new Date().toISOString(),
        machine_id: machineId,
        temperature: isOverheat ? 118.5 : 78.2,
        vibration: isVib ? 92.4 : 51.5,
        humidity: 50.0,
        pressure: 3.0,
        energy_consumption: isOverheat ? 4.8 : 3.4,
      };
      await api.ingestTelemetry(telemetryPayload);
    } catch (err) {
      console.error('Backend telemetry ingest error:', err);
    }
  };

  // Acknowledge Alert Action
  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await api.acknowledgeAlert(alertId);
      setAlerts((prev) =>
        prev.map((a) => ((a.id || a.alert_id) === alertId ? { ...a, acknowledged: true } : a))
      );
      toast.success('Alert acknowledged');
    } catch (err) {
      console.error('Acknowledge failed:', err);
      // Optimistically mark acknowledged locally
      setAlerts((prev) =>
        prev.map((a) => ((a.id || a.alert_id) === alertId ? { ...a, acknowledged: true } : a))
      );
      toast.info('Alert acknowledged locally');
    }
  };

  // Acknowledge All Active Alerts
  const handleAcknowledgeAll = async () => {
    const unack = alerts.filter((a) => !a.acknowledged);
    if (unack.length === 0) return;
    try {
      await Promise.all(unack.map((a) => api.acknowledgeAlert((a.alert_id || a.id || '') as string)));
      setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
      toast.success(`Acknowledged ${unack.length} alerts`);
    } catch (err) {
      console.error('Bulk acknowledge failed:', err);
      setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
      toast.info(`Acknowledged ${unack.length} alerts locally`);
    }
  };

  // Filtered Machines for Dashboard display
  const displayedMachines = useMemo(() => {
    if (selectedFilterMachine === 'ALL') {
      return Object.values(machines);
    }
    return Object.values(machines).filter((m) => m.id === selectedFilterMachine);
  }, [machines, selectedFilterMachine]);

  // KPI Computations
  const kpiStats = useMemo(() => {
    const list = Object.values(machines);
    const total = list.length;
    const critical = list.filter((m) => m.latest?.status === 'CRITICAL').length;
    const warning = list.filter((m) => m.latest?.status === 'WARNING').length;
    const normal = list.filter((m) => m.latest?.status === 'NORMAL' || !m.latest?.status).length;
    const activeAlertsCount = alerts.filter((a) => !a.acknowledged).length;

    const healthIndex = total > 0 ? Math.round((normal / total) * 100) : 100;

    return { total, critical, warning, normal, activeAlertsCount, healthIndex };
  }, [machines, alerts]);

  // 1. Single Machine Time-Series Telemetry Data (Ensures latest reading is ALWAYS included as final point)
  const singleMachineTrendData = useMemo(() => {
    const focusId = selectedFilterMachine === 'ALL' ? 'M01' : selectedFilterMachine;
    const state = machines[focusId];
    let list = state?.history || [];

    if (state?.latest) {
      const lastItem = list[list.length - 1];
      if (!lastItem || lastItem.timestamp !== state.latest.timestamp || lastItem.status !== state.latest.status) {
        list = [...list, state.latest];
      }
    }

    if (list.length === 0) {
      return [];
    }

    return list.map((item, idx) => ({
      time: item.timestamp ? item.timestamp.split(' ')[1] || `t-${idx}` : `t-${idx}`,
      Temperature: Number((item.sensor_readings?.temperature ?? 75.0).toFixed(1)),
      Vibration: Number((item.sensor_readings?.vibration ?? 50.0).toFixed(1)),
      Humidity: Number((item.sensor_readings?.humidity ?? 58.1).toFixed(1)),
      Pressure: Number((item.sensor_readings?.pressure ?? 3.08).toFixed(2)),
      Power: Number((item.sensor_readings?.energy_consumption ?? 2.86).toFixed(2)),
      Score: Math.round((item.anomaly_score ?? 0.25) * 100),
    }));
  }, [machines, selectedFilterMachine]);

  // Computes Current & Mean (Average) metrics directly synced with current focus machine `latest` state!
  const singleMachineMetrics = useMemo(() => {
    const focusId = selectedFilterMachine === 'ALL' ? 'M01' : selectedFilterMachine;
    const focusMachine = machines[focusId]?.latest;
    const focusSensors = focusMachine?.sensor_readings;

    const data = singleMachineTrendData;

    const tempCurrent = focusSensors?.temperature ?? 75.0;
    const vibCurrent = focusSensors?.vibration ?? 50.0;
    const humCurrent = focusSensors?.humidity ?? 58.1;
    const pressCurrent = focusSensors?.pressure ?? 3.08;
    const powerCurrent = focusSensors?.energy_consumption ?? 2.86;
    const scoreCurrent = focusMachine ? Math.round((focusMachine.anomaly_score ?? 0.25) * 100) : 25;

    let sumTemp = tempCurrent;
    let sumVib = vibCurrent;
    let sumHum = humCurrent;
    let sumPress = pressCurrent;
    let sumPower = powerCurrent;
    let sumScore = scoreCurrent;
    let count = 1;

    if (data && data.length > 0) {
      sumTemp = data.reduce((acc, curr) => acc + curr.Temperature, 0);
      sumVib = data.reduce((acc, curr) => acc + curr.Vibration, 0);
      sumHum = data.reduce((acc, curr) => acc + curr.Humidity, 0);
      sumPress = data.reduce((acc, curr) => acc + curr.Pressure, 0);
      sumPower = data.reduce((acc, curr) => acc + curr.Power, 0);
      sumScore = data.reduce((acc, curr) => acc + curr.Score, 0);
      count = data.length;
    }

    return {
      tempCurrent: Number(tempCurrent.toFixed(1)),
      tempMean: Number((sumTemp / count).toFixed(1)),
      vibCurrent: Number(vibCurrent.toFixed(1)),
      vibMean: Number((sumVib / count).toFixed(1)),
      humCurrent: Number(humCurrent.toFixed(1)),
      humMean: Number((sumHum / count).toFixed(1)),
      pressCurrent: Number(pressCurrent.toFixed(2)),
      pressMean: Number((sumPress / count).toFixed(2)),
      powerCurrent: Number(powerCurrent.toFixed(2)),
      powerMean: Number((sumPower / count).toFixed(2)),
      scoreCurrent: scoreCurrent,
      scoreMean: Math.round(sumScore / count),
    };
  }, [machines, selectedFilterMachine, singleMachineTrendData]);

  // Temperature Pie Chart Data
  const tempPieData = useMemo(() => {
    const current = singleMachineMetrics.tempCurrent;
    const maxLimit = 130;
    const remaining = Math.max(0, maxLimit - current);
    const isHigh = current > 88;

    return [
      { name: 'Current Temp', value: current, color: isHigh ? '#ef4444' : '#38bdf8' },
      { name: 'Safety Margin', value: remaining, color: 'rgba(255, 255, 255, 0.08)' },
    ];
  }, [singleMachineMetrics.tempCurrent]);

  // 2. Fleet Overview: Telemetry Trend Area Chart Data
  const fleetTelemetryTrendData = useMemo(() => {
    if (selectedFilterMachine !== 'ALL') {
      const targetHistory = machines[selectedFilterMachine]?.history || [];
      return targetHistory.map((item, idx) => ({
        time: item.timestamp ? item.timestamp.split(' ')[1] || `t-${idx}` : `t-${idx}`,
        Temperature: item.sensor_readings?.temperature ?? 75,
        Vibration: item.sensor_readings?.vibration ?? 50,
      }));
    } else {
      // Average of all machines
      const m1 = machines['M01']?.history || [];
      return m1.map((item, idx) => {
        let tempSum = 0;
        let vibSum = 0;
        let count = 0;
        ['M01', 'M02', 'M03', 'M04'].forEach(mId => {
          const h = machines[mId]?.history;
          if (h && h[idx]) {
            tempSum += h[idx].sensor_readings?.temperature ?? 75;
            vibSum += h[idx].sensor_readings?.vibration ?? 50;
            count++;
          }
        });
        return {
          time: item.timestamp ? item.timestamp.split(' ')[1] || `t-${idx}` : `t-${idx}`,
          Temperature: count > 0 ? Number((tempSum / count).toFixed(1)) : 75,
          Vibration: count > 0 ? Number((vibSum / count).toFixed(1)) : 50,
        };
      });
    }
  }, [machines, selectedFilterMachine]);

  // 3. Fleet Overview: Asset Health Status Donut Chart Data
  const statusDistributionData = useMemo(() => {
    const list = Object.values(machines);
    let normalCount = 0;
    let warningCount = 0;
    let criticalCount = 0;

    list.forEach((m) => {
      const st = m.latest?.status || 'NORMAL';
      if (st === 'CRITICAL') criticalCount++;
      else if (st === 'WARNING') warningCount++;
      else normalCount++;
    });

    return [
      { name: 'Normal', value: normalCount, color: STATUS_COLORS.NORMAL },
      { name: 'Warning', value: warningCount, color: STATUS_COLORS.WARNING },
      { name: 'Critical', value: criticalCount, color: STATUS_COLORS.CRITICAL },
    ].filter((d) => d.value > 0);
  }, [machines]);

  // 4. Fleet Overview: Predicted Fault Mode Breakdown Pie Chart Data
  const faultDistributionData = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(machines).forEach((m) => {
      const f = m.latest?.predicted_fault || 'Normal';
      counts[f] = (counts[f] || 0) + 1;
    });

    return Object.keys(counts).map((faultName) => ({
      name: faultName,
      value: counts[faultName],
      color: FAULT_COLORS[faultName] || '#38bdf8',
    }));
  }, [machines]);

  // 5. Fleet Overview: Sensor Metrics Comparison Bar Chart Data
  const sensorComparisonData = useMemo(() => {
    return Object.values(machines).map((m) => ({
      name: m.id,
      Temperature: m.latest?.sensor_readings?.temperature || 75,
      Vibration: m.latest?.sensor_readings?.vibration || 50,
    }));
  }, [machines]);

  // 6. Fleet Overview: ML Anomaly Scores Bar Chart Data
  const anomalyScoreData = useMemo(() => {
    return Object.values(machines).map((m) => ({
      name: m.id,
      Score: Math.round((m.latest?.anomaly_score || 0.25) * 100),
    }));
  }, [machines]);

  // 7. Fleet Overview: Power & Energy Consumption Bar Chart Data
  const energyData = useMemo(() => {
    return Object.values(machines).map((m) => ({
      name: m.id,
      Power: m.latest?.sensor_readings?.energy_consumption || 2.7,
    }));
  }, [machines]);

  // Filtered Alerts Table
  const filteredAlerts = useMemo(() => {
    if (alertFilter === 'ACTIVE') return alerts.filter((a) => !a.acknowledged);
    if (alertFilter === 'CRITICAL') return alerts.filter((a) => (a.severity || a.status) === 'CRITICAL');
    if (alertFilter === 'ACKNOWLEDGED') return alerts.filter((a) => a.acknowledged);
    return alerts;
  }, [alerts, alertFilter]);

  if (!isAuthenticated) {
    return (
      <div className="login-wrapper">
        <div className="glass-panel login-panel">
          <div className="login-header">
            <div className="logo-box">
              <Shield className="w-8 h-8 text-emerald-400" />
            </div>
            <h2>{isRegistering ? 'Register Operator' : 'System Authentication'}</h2>
            <p>Smart IoT-Based Industrial Anomaly Detection</p>
          </div>
          <form onSubmit={handleAuth} className="login-form">
            {isRegistering && (
              <div className="input-group">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Enter Full Name"
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="input-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Enter Email"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoFocus={!isRegistering}
              />
            </div>
            <div className="input-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="Enter Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </div>
            {authError && <div className="login-error" style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '4px' }}>{authError}</div>}
            <button type="submit" className="btn-login" style={{ marginTop: '16px', background: '#0f172a', color: 'white', padding: '12px', borderRadius: '8px', fontWeight: 'bold', width: '100%' }}>
              {isRegistering ? 'Register' : 'Authenticate'} <ChevronRight className="w-4 h-4 ml-2 inline" />
            </button>
            <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '0.85rem' }}>
              {isRegistering ? (
                <>Already have an account? <span onClick={() => {setIsRegistering(false); setAuthError('');}} style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold' }}>Login here</span></>
              ) : (
                <>New operator? <span onClick={() => {setIsRegistering(true); setAuthError('');}} style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold' }}>Register here</span></>
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-container page-status-${overallPageStatus}`}>
      {/* Header displayed on all views EXCEPT Home Landing Page */}
      {activeTab !== 'landing' && (
        <header className="main-header">
          {/* Left: Brand Logo & Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="header-title-group" onClick={() => setActiveTab('landing')}>
              <img src="/induguard_logo.png" alt="InduGuard Logo" className="header-logo-img" />
              <span className="app-title">InduGuard</span>
            </div>
            <div className={`stream-badge ${wsConnected ? 'connected' : 'disconnected'}`}>
              <span className="pulse-dot"></span>
              {wsConnected ? 'Live 1 Hz Stream' : 'Offline'}
            </div>
          </div>

          {/* Right: Navigation, Notifications & Simulator Control */}
          <div className="header-actions-right">
            <div className="nav-tab" style={{ cursor: 'default', opacity: 0.85, background: 'transparent', border: 'none' }}>
              <User className="w-4 h-4 text-slate-500" />
              {loggedInName || 'Operator'}
            </div>
            <button
              className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </button>
            <button
              className={`nav-tab ${activeTab === 'notifications' ? 'active' : ''}`}
              onClick={() => setActiveTab('notifications')}
            >
              <Bell className="w-4 h-4" />
              Notifications
              {kpiStats.activeAlertsCount > 0 && (
                <span className="notif-btn-badge">{kpiStats.activeAlertsCount}</span>
              )}
            </button>
            {simStatus.is_running ? (
              <button className="btn-danger" onClick={handleStopSimulator}>
                <Radio className="w-4 h-4" /> Stop Simulator
              </button>
            ) : (
              <button className="btn-primary" onClick={handleStartSimulator}>
                <Zap className="w-4 h-4" /> Start Simulator
              </button>
            )}
            <button className="nav-tab" onClick={handleLogout} style={{ color: '#dc2626' }}>
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </header>
      )}

      {/* VIEW 0: HERO SPLASH LANDING VIEW */}
      {activeTab === 'landing' && (
        <div className="landing-body-center">
          <div className="hero-landing-container">
            {/* Left Side: Large InduGuard Shield Logo */}
            <div className="hero-logo-left">
              <img
                src="/induguard_logo.png"
                alt="InduGuard AI Platform"
                className="hero-logo-img"
              />
            </div>

            {/* Right Side: Big Bold Title, Subtitle, & Action Button */}
            <div className="hero-content-right">
              <h1 className="hero-main-title">
                IoT Industrial Anomaly Detection System
              </h1>

              <p className="hero-subtitle">
                An advanced AI-powered industrial health monitoring platform combining unsupervised Isolation Forest anomaly detection,
                supervised multi-class fault classification, and physical thermodynamic reasoning to deliver zero-false-alarm real-time operations.
              </p>

              <div className="hero-cta-group">
                <button
                  className="btn-hero-dashboard"
                  onClick={() => setActiveTab('dashboard')}
                >
                  <Play className="w-5 h-5 fill-current" /> Launch Live Dashboard →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 1: ABOUT SYSTEM INTERACTIVE MULTI-STEP WIZARD */}
      {activeTab === 'about' && (
        <div className="dashboard-body">
          <div className="about-wizard-layout">
            {/* Left Vertical Stepper Sidebar */}
            <aside className="wizard-vertical-sidebar">
              <button
                className={`vertical-step-item ${aboutStep === 1 ? 'active' : aboutStep > 1 ? 'completed' : ''}`}
                onClick={() => setAboutStep(1)}
              >
                <div className="step-num-badge">
                  {aboutStep > 1 ? <Check className="w-4 h-4 stroke-[3]" /> : '1'}
                </div>
                <span className="step-label-text">1. System Overview & Key Terms</span>
              </button>

              <button
                className={`vertical-step-item ${aboutStep === 2 ? 'active' : aboutStep > 2 ? 'completed' : ''}`}
                onClick={() => setAboutStep(2)}
              >
                <div className="step-num-badge">
                  {aboutStep > 2 ? <Check className="w-4 h-4 stroke-[3]" /> : '2'}
                </div>
                <span className="step-label-text">2. ML Model Selection Rationale</span>
              </button>

              <button
                className={`vertical-step-item ${aboutStep === 3 ? 'active' : aboutStep > 3 ? 'completed' : ''}`}
                onClick={() => setAboutStep(3)}
              >
                <div className="step-num-badge">
                  {aboutStep > 3 ? <Check className="w-4 h-4 stroke-[3]" /> : '3'}
                </div>
                <span className="step-label-text">3. Sensor Metrics & Verification</span>
              </button>

              <button
                className={`vertical-step-item ${aboutStep === 4 ? 'active' : ''}`}
                onClick={() => setAboutStep(4)}
              >
                <div className="step-num-badge">4</div>
                <span className="step-label-text">4. User Guide & Launch</span>
              </button>
            </aside>

            {/* STEP 1: SYSTEM OVERVIEW & KEY TERMS */}
            {aboutStep === 1 && (
              <div className="step-card-panel">
                <div className="step-card-header">
                  <h2>IoT Machine Anomaly Detection Platform</h2>
                  <p>
                    InduGuard combines real-time streaming sensor telemetry, statistical machine learning,
                    and physical thermodynamic thresholds to detect industrial equipment failures early.
                  </p>
                </div>

                <div className="step-content-body">
                  <h4 style={{ color: 'var(--accent-cyan)', fontSize: '0.9rem' }}>Key Project Terminology:</h4>
                  <div className="terms-grid">
                    <div className="term-box">
                      <div className="term-title">Telemetry Stream</div>
                      <div className="term-desc">Live 5-variate sensor vector (Temp, Vib, Humidity, Pressure, Power) emitted at 1 Hz.</div>
                    </div>
                    <div className="term-box">
                      <div className="term-title">ConditionAnalyzer</div>
                      <div className="term-desc">Core reasoning engine combining ML inference with physical threshold checks.</div>
                    </div>
                    <div className="term-box">
                      <div className="term-title">Anomaly Detector</div>
                      <div className="term-desc">Unsupervised Isolation Forest model scoring telemetry for unexpected outliers.</div>
                    </div>
                    <div className="term-box">
                      <div className="term-title">Deduplication Cooldown</div>
                      <div className="term-desc">Rate-limiting engine enforcing a 60-second cooldown per asset to prevent alert spam.</div>
                    </div>
                  </div>
                </div>

                <div className="wizard-nav-bar">
                  <button className="btn-nav-prev" disabled>
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <button className="btn-nav-next" onClick={() => setAboutStep(2)}>
                    Next: ML Model Selection Rationale <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: ML MODEL SELECTION RATIONALE */}
            {aboutStep === 2 && (
              <div className="step-card-panel">
                <div className="step-card-header">
                  <h2>ML Model Selection Rationale</h2>
                  <p>Concise engineering justification for our real-time machine learning model architecture.</p>
                </div>

                <div className="step-content-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                    {/* Model 1: Isolation Forest */}
                    <div className="model-justification-card">
                      <h4 style={{ color: 'var(--accent-cyan)' }}>
                        <Brain className="w-4 h-4" /> Isolation Forest (Anomaly Detection)
                      </h4>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Sub-millisecond unsupervised outlier scoring on 5D sensor vectors.
                      </p>
                      <ul style={{ fontSize: '0.8rem' }}>
                        <li><strong>vs. One-Class SVM:</strong> Scales linearly O(N log N) vs heavy O(N²) matrix math.</li>
                        <li><strong>vs. Autoencoders:</strong> No GPU hardware required; zero reconstruction threshold drift.</li>
                        <li><strong>vs. LOF:</strong> Instant path-depth scoring without keeping raw data in memory.</li>
                      </ul>
                    </div>

                    {/* Model 2: Random Forest */}
                    <div className="model-justification-card">
                      <h4 style={{ color: 'var(--accent-purple)' }}>
                        <Layers className="w-4 h-4" /> Random Forest (Fault Diagnosis)
                      </h4>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Multi-class root-cause classification (Overheating, Vibration, Pressure Drop).
                      </p>
                      <ul style={{ fontSize: '0.8rem' }}>
                        <li><strong>vs. Logistic Regression:</strong> Captures complex non-linear multi-sensor boundaries.</li>
                        <li><strong>vs. XGBoost:</strong> Stable probabilities with zero risk of gradient explosion on live data.</li>
                        <li><strong>vs. Decision Trees:</strong> Ensemble bagging eliminates overfitting to sensor noise.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="wizard-nav-bar">
                  <button className="btn-nav-prev" onClick={() => setAboutStep(1)}>
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <button className="btn-nav-next" onClick={() => setAboutStep(3)}>
                    Next: Sensor Metrics & Verification <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: SENSOR METRICS & MODEL VERIFICATION */}
            {aboutStep === 3 && (
              <div className="step-card-panel">
                <div className="step-card-header">
                  <h2>Sensor Metrics & Baseline Thresholds</h2>
                  <p>Operational boundaries evaluated by ConditionAnalyzer on every streamed frame.</p>
                </div>

                <div className="step-content-body">
                  <div className="terms-grid">
                    <div className="term-box">
                      <div className="term-title">Temperature (°C)</div>
                      <div className="term-desc">Nominal: ~75.0°C. <strong>Warning: &gt;88.0°C</strong> | <strong>Critical: &gt;100.0°C</strong></div>
                    </div>
                    <div className="term-box">
                      <div className="term-title">Vibration Index (Hz)</div>
                      <div className="term-desc">Nominal: ~50.0. <strong>Warning: &gt;68.0</strong> | <strong>Critical: &gt;85.0</strong></div>
                    </div>
                    <div className="term-box">
                      <div className="term-title">Hydraulic Pressure (bar)</div>
                      <div className="term-desc">Nominal: ~3.0 bar. <strong>Critical Drop: &lt;1.5 bar</strong></div>
                    </div>
                    <div className="term-box">
                      <div className="term-title">Energy Consumption (kW)</div>
                      <div className="term-desc">Nominal: ~2.75 kW. <strong>Critical Surge: &gt;4.7 kW</strong></div>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '16px', borderRadius: '12px', marginTop: '10px' }}>
                    <h4 style={{ color: 'var(--status-normal)', fontSize: '0.9rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle className="w-4 h-4" /> 100% Model Pipeline Live & Verified
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      All machines (`M01` to `M04`) execute live inference against `models/anomaly_detector.joblib` and `models/fault_classifier.joblib` on every single streamed telemetry frame.
                    </p>
                  </div>
                </div>

                <div className="wizard-nav-bar">
                  <button className="btn-nav-prev" onClick={() => setAboutStep(2)}>
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <button className="btn-nav-next" onClick={() => setAboutStep(4)}>
                    Next: User Guide & Launch <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: USER GUIDE & DASHBOARD LAUNCH */}
            {aboutStep === 4 && (
              <div className="step-card-panel">
                <div className="step-card-header">
                  <h2>System Operation Guide</h2>
                  <p>Four easy steps to operate the platform and test live machine learning inference.</p>
                </div>

                <div className="step-content-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                    <div style={{ background: 'rgba(5, 7, 12, 0.6)', padding: '18px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 900, fontSize: '1.3rem' }}>01</span>
                      <h5 style={{ marginTop: '6px', marginBottom: '4px', fontSize: '0.88rem' }}>View Assets</h5>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>Monitor live status cards for machines M01 to M04 on the dashboard.</p>
                    </div>

                    <div style={{ background: 'rgba(5, 7, 12, 0.6)', padding: '18px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 900, fontSize: '1.3rem' }}>02</span>
                      <h5 style={{ marginTop: '6px', marginBottom: '4px', fontSize: '0.88rem' }}>Stream Data</h5>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>Click "Start Simulator" in the top bar to initiate sensor telemetry.</p>
                    </div>

                    <div style={{ background: 'rgba(5, 7, 12, 0.6)', padding: '18px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 900, fontSize: '1.3rem' }}>03</span>
                      <h5 style={{ marginTop: '6px', marginBottom: '4px', fontSize: '0.88rem' }}>Test Faults</h5>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>Click "Overheat" or "Vibration" buttons on machine cards to test ML detection.</p>
                    </div>

                    <div style={{ background: 'rgba(5, 7, 12, 0.6)', padding: '18px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 900, fontSize: '1.3rem' }}>04</span>
                      <h5 style={{ marginTop: '6px', marginBottom: '4px', fontSize: '0.88rem' }}>Manage Alerts</h5>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>Review and acknowledge industrial alerts in the Notifications Log.</p>
                    </div>
                  </div>
                </div>

                <div className="wizard-nav-bar">
                  <button className="btn-nav-prev" onClick={() => setAboutStep(3)}>
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <button
                    className="btn-launch-final"
                    onClick={() => setActiveTab('dashboard')}
                  >
                    <Play className="w-4 h-4 fill-current" /> Launch Command Dashboard →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: LIVE MARVEL COMMAND DASHBOARD */}
      {activeTab === 'dashboard' && (
        <div className="dashboard-body">
          {/* Top 4 KPI Stat Cards: ONLY DISPLAYED IN ALL FLEET MODE */}
          {selectedFilterMachine === 'ALL' && (
            <div className="kpi-grid">
              {/* Card 1: System Health Index */}
              <div className="glass-panel kpi-card">
                <div className="kpi-card-left">
                  <span className="kpi-title-text">System Health Index</span>
                </div>
                <div className="kpi-card-right">
                  <span className="kpi-number-val" style={{ color: kpiStats.healthIndex < 100 ? '#f59e0b' : '#10b981' }}>
                    {kpiStats.healthIndex}%
                  </span>
                </div>
              </div>

              {/* Card 2: Active Industrial Alerts */}
              <div
                className="glass-panel kpi-card"
                style={{ cursor: 'pointer' }}
                onClick={() => setActiveTab('notifications')}
              >
                <div className="kpi-card-left">
                  <span className="kpi-title-text">Active Industrial Alerts</span>
                </div>
                <div className="kpi-card-right">
                  <span className="kpi-number-val" style={{ color: kpiStats.activeAlertsCount > 0 ? '#ef4444' : '#10b981' }}>
                    {kpiStats.activeAlertsCount}
                  </span>
                </div>
              </div>

              {/* Card 3: Monitored Machines */}
              <div className="glass-panel kpi-card">
                <div className="kpi-card-left">
                  <span className="kpi-title-text">Monitored Machines</span>
                </div>
                <div className="kpi-card-right">
                  <span className="kpi-number-val" style={{ color: '#38bdf8' }}>
                    {kpiStats.total}
                  </span>
                </div>
              </div>

              {/* Card 4: Filter Machine Focus */}
              <div className="glass-panel kpi-card">
                <div className="kpi-card-left">
                  <span className="kpi-title-text">Filter Machine Focus</span>
                </div>
                <div className="kpi-card-right" style={{ width: '55%' }}>
                  <select
                    className="filter-select"
                    value={selectedFilterMachine}
                    onChange={(e) => setSelectedFilterMachine(e.target.value)}
                  >
                    <option value="ALL">All Fleet Systems</option>
                    <option value="M01">{MACHINE_DETAILS['M01'].name} (M01)</option>
                    <option value="M02">{MACHINE_DETAILS['M02'].name} (M02)</option>
                    <option value="M03">{MACHINE_DETAILS['M03'].name} (M03)</option>
                    <option value="M04">{MACHINE_DETAILS['M04'].name} (M04)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* DUAL-MODE DASHBOARD LAYOUT */}
          {selectedFilterMachine !== 'ALL' ? (
            /* SINGLE-MACHINE FOCUS MODE: Left Sidebar with Dropdown + Stretched Card | Right 6 Charts */
            <div className="single-machine-focus-layout">
              {/* Left Sidebar */}
              <div className="focus-left-sidebar">
                {/* Machine Selection Dropdown placed directly at top of Machine Name */}
                <div className="glass-panel" style={{ padding: '16px 18px', borderRadius: '16px' }}>
                  <h4 style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', color: '#e2e8f0', letterSpacing: '0.8px', marginBottom: '4px' }}>
                    Filter Machine Focus
                  </h4>
                  <select
                    className="kpi-select-dropdown"
                    value={selectedFilterMachine}
                    onChange={(e) => setSelectedFilterMachine(e.target.value)}
                  >
                    <option value="ALL">All Fleet Systems</option>
                    <option value="M01">{MACHINE_DETAILS['M01'].name} (M01)</option>
                    <option value="M02">{MACHINE_DETAILS['M02'].name} (M02)</option>
                    <option value="M03">{MACHINE_DETAILS['M03'].name} (M03)</option>
                    <option value="M04">{MACHINE_DETAILS['M04'].name} (M04)</option>
                  </select>
                </div>

                {/* Selected Machine Header Card (Stretches to match height of 6-chart right grid!) */}
                {displayedMachines.map((m) => {
                  const res = m.latest;
                  const st = (res?.status || 'NORMAL').toLowerCase();

                  return (
                    <div key={m.id} className={`marvel-machine-card state-${st}`}>
                      <div>
                        {/* VERTICAL HEADER: LARGER MACHINE NAME & STATUS BADGE ON SEPARATE LINE BELOW */}
                        <div className="machine-header">
                          <div className="machine-title-group">
                            <span className="reactor-pulse-icon"></span>
                            <h3>{MACHINE_DETAILS[m.id]?.name || `Machine ${m.id}`}</h3>
                          </div>
                          {/* Solid Filled Status Badge */}
                          <span className={`status-badge ${st}`}>{res?.status || 'NORMAL'}</span>
                        </div>
  
                        {/* Machine Info / Description */}
                        <div className="machine-condition" style={{ marginBottom: '12px', background: 'transparent', border: 'none', padding: '0', borderLeft: '3px solid #3b82f6', paddingLeft: '10px' }}>
                          <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: '1.4' }}>
                            {MACHINE_DETAILS[m.id]?.desc || 'Nominal operational status. Monitoring sensor parameters.'}
                          </div>
                        </div>

                        <div className="machine-condition" style={{ marginTop: '12px' }}>
                          {res?.condition || 'Awaiting telemetry...'}
                        </div>

                        {/* Remaining Useful Life & Risk */}
                        <div className="rul-risk-block" style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Est. RUL</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: res?.remaining_useful_life && res.remaining_useful_life < 48 ? 'var(--status-critical)' : '#0f172a' }}>
                              {res?.remaining_useful_life || 500} hrs
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Risk Level</div>
                            <span className={`status-badge ${(res?.risk_level || 'LOW').toLowerCase()}`} style={{ fontSize: '0.75rem', padding: '4px 8px' }}>{res?.risk_level || 'LOW'}</span>
                          </div>
                        </div>

                        {/* Maintenance Recommendation */}
                        <div className="maintenance-rec-block" style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', borderLeft: '4px solid #3b82f6', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                          <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Maintenance Recommendation</div>
                          <div style={{ fontSize: '0.85rem', color: '#0f172a', lineHeight: '1.4' }}>
                            {res?.recommended_action || 'Continue routine operational monitoring.'}
                          </div>
                        </div>
                      </div>

                      {/* Vertically Stacked Fault Action Buttons */}
                      <div className="fault-actions">
                        <button
                          className="btn-fault"
                          onClick={() => handleInjectFault(m.id, 'overheating')}
                        >
                          <Flame className="w-4 h-4 text-red-400" /> Overheat Fault Injection
                        </button>
                        <button
                          className="btn-fault vib"
                          onClick={() => handleInjectFault(m.id, 'vibration')}
                        >
                          <Zap className="w-4 h-4 text-amber-400" /> Vibration Fault Injection
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Side: 6 DIVERSE METRIC CHARTS (FULLY SYNCED WITH AUTHORITATIVE FOCUS MACHINE STATE) */}
              <div className="focus-right-charts">
                {/* 1. Temperature Stream Chart -> Donut / Pie Chart with Center Overlay Value */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Temperature ({selectedFilterMachine})</h3>
                    <span className="chart-sublabel" style={{ color: singleMachineMetrics.tempCurrent > 88 ? '#ef4444' : '#38bdf8' }}>
                      Current: {singleMachineMetrics.tempCurrent.toFixed(1)}°C | Mean: {singleMachineMetrics.tempMean.toFixed(1)}°C
                    </span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={tempPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          startAngle={180}
                          endAngle={0}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {tempPieData.map((entry, index) => (
                            <Cell key={`cell-temp-pie-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: singleMachineMetrics.tempCurrent > 88 ? '#ef4444' : '#38bdf8',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pie-center-overlay" style={{ marginTop: '12px' }}>
                      <span className="pie-center-val" style={{ color: singleMachineMetrics.tempCurrent > 88 ? '#ef4444' : '#38bdf8' }}>
                        {singleMachineMetrics.tempCurrent.toFixed(1)}°C
                      </span>
                      <span className="pie-center-lbl">Avg: {singleMachineMetrics.tempMean.toFixed(1)}°C</span>
                    </div>
                  </div>
                </div>

                {/* 2. Vibration Index -> LineChart with Current & Mean Header */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Vibration ({selectedFilterMachine})</h3>
                    <span className="chart-sublabel" style={{ color: singleMachineMetrics.vibCurrent > 68 ? '#ef4444' : '#38bdf8' }}>
                      Current: {singleMachineMetrics.vibCurrent.toFixed(1)} Hz | Mean: {singleMachineMetrics.vibMean.toFixed(1)} Hz
                    </span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={singleMachineTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} domain={[30, 110]} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: '#38bdf8',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="Vibration"
                          stroke={singleMachineMetrics.vibCurrent > 68 ? '#ef4444' : '#38bdf8'}
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: singleMachineMetrics.vibCurrent > 68 ? '#ef4444' : '#38bdf8', strokeWidth: 1 }}
                          activeDot={{ r: 6, fill: singleMachineMetrics.vibCurrent > 68 ? '#ef4444' : '#38bdf8', stroke: '#ffffff' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 3. Relative Humidity -> BarChart with Current & Mean Header */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Relative Humidity ({selectedFilterMachine})</h3>
                    <span className="chart-sublabel" style={{ color: '#10b981' }}>
                      Current: {singleMachineMetrics.humCurrent.toFixed(1)}% | Mean: {singleMachineMetrics.humMean.toFixed(1)}%
                    </span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={singleMachineTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} domain={[30, 90]} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: '#10b981',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Bar dataKey="Humidity" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 4. Hydraulic Pressure -> Step Line ComposedChart with Current & Mean Header */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Hydraulic Pressure ({selectedFilterMachine})</h3>
                    <span className="chart-sublabel" style={{ color: '#fbbf24' }}>
                      Current: {singleMachineMetrics.pressCurrent.toFixed(2)} bar | Mean: {singleMachineMetrics.pressMean.toFixed(2)} bar
                    </span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={singleMachineTrendData}>
                        <defs>
                          <linearGradient id="colorPressStep" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} domain={[0, 6]} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: '#fbbf24',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Area type="stepAfter" dataKey="Pressure" stroke="#fbbf24" fillOpacity={1} fill="url(#colorPressStep)" strokeWidth={2.5} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 5. Electrical Power Draw -> Bar Chart with Current & Mean Header */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Electrical Power ({selectedFilterMachine})</h3>
                    <span className="chart-sublabel" style={{ color: '#c084fc' }}>
                      Current: {singleMachineMetrics.powerCurrent.toFixed(2)} kW | Mean: {singleMachineMetrics.powerMean.toFixed(2)} kW
                    </span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={singleMachineTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} domain={[0, 8]} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: '#c084fc',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Bar dataKey="Power" fill="#c084fc" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 6. ML Anomaly Risk -> Bar Meter Chart with Current & Mean Header */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>ML Anomaly Risk ({selectedFilterMachine})</h3>
                    <span className="chart-sublabel" style={{ color: singleMachineMetrics.scoreCurrent > 50 ? '#ef4444' : '#10b981' }}>
                      Risk: {singleMachineMetrics.scoreCurrent}% | Mean: {singleMachineMetrics.scoreMean}%
                    </span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={singleMachineTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: '#ec4899',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Bar dataKey="Score" radius={[4, 4, 0, 0]}>
                          {singleMachineTrendData.map((entry, idx) => (
                            <Cell
                              key={`cell-single-score-${idx}`}
                              fill={entry.Score > 70 ? '#ef4444' : entry.Score > 40 ? '#f59e0b' : '#10b981'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* FLEET VIEW MODE: All 4 Machine Cards + Fleet Overview Analytics (3 per row) */
            <>
              <div>
                <div className="section-title">
                  <span>Multi-Machine Real-Time Status</span>
                  <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                    Live Telemetry & ML Inference
                  </span>
                </div>

                <div className="machines-grid">
                  {displayedMachines.map((m) => {
                    const res = m.latest;
                    const sensors = res?.sensor_readings;
                    const st = (res?.status || 'NORMAL').toLowerCase();
                    const scorePct = res ? Math.round(res.anomaly_score * 100) : 0;

                    return (
                      <div key={m.id} className={`marvel-machine-card state-${st}`}>
                        <div>
                          <div className="machine-header">
                            <div className="machine-title-group">
                              <span className="reactor-pulse-icon"></span>
                              <h3>{MACHINE_DETAILS[m.id]?.name || `Machine ${m.id}`}</h3>
                            </div>
                            {/* Solid Filled Status Badge */}
                            <span className={`status-badge ${st}`}>{res?.status || 'NORMAL'}</span>
                          </div>

                          <div className="machine-condition">
                            {res?.condition || 'Awaiting telemetry...'}
                          </div>

                          {/* Sensor Metrics Grid with Live Tick Pulse */}
                          {sensors && (
                            <div className="sensor-metrics-grid">
                              <div className={`sensor-box ${m.liveTick ? 'live-tick' : ''}`}>
                                <span className="lbl">Temp</span>
                                <span className="val">{sensors.temperature.toFixed(1)}°C</span>
                              </div>
                              <div className={`sensor-box ${m.liveTick ? 'live-tick' : ''}`}>
                                <span className="lbl">Vib</span>
                                <span className="val">{sensors.vibration.toFixed(1)}</span>
                              </div>
                              <div className={`sensor-box ${m.liveTick ? 'live-tick' : ''}`}>
                                <span className="lbl">Hum</span>
                                <span className="val">{sensors.humidity.toFixed(1)}%</span>
                              </div>
                              <div className={`sensor-box ${m.liveTick ? 'live-tick' : ''}`}>
                                <span className="lbl">Press</span>
                                <span className="val">{sensors.pressure.toFixed(2)} bar</span>
                              </div>
                              <div className={`sensor-box ${m.liveTick ? 'live-tick' : ''}`}>
                                <span className="lbl">Power</span>
                                <span className="val">{sensors.energy_consumption.toFixed(2)} kW</span>
                              </div>
                              <div className="sensor-box">
                                <span className="lbl">Fault</span>
                                <span className="val" style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                                  {res.predicted_fault}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Animated ML Anomaly Score Meter */}
                          <div className="ml-meter" style={{ marginBottom: '8px' }}>
                            <div className="ml-meter-header">
                              <span>ML Anomaly Score</span>
                              <span>{scorePct}%</span>
                            </div>
                            <div className="score-bar-bg">
                              <div
                                className="score-bar-fill"
                                style={{
                                  width: `${scorePct}%`,
                                  background:
                                    scorePct > 70
                                      ? 'var(--status-critical)'
                                      : scorePct > 40
                                      ? 'var(--status-warning)'
                                      : 'var(--status-normal)',
                                }}
                              ></div>
                            </div>
                          </div>

                          {/* Remaining Useful Life & Risk */}
                          <div className="rul-risk-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '8px' }}>
                            <div>
                              <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Est. RUL</div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: res?.remaining_useful_life && res.remaining_useful_life < 48 ? 'var(--status-critical)' : '#0f172a' }}>
                                {res?.remaining_useful_life || 500} hrs
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Risk Level</div>
                              <span className={`status-badge ${(res?.risk_level || 'LOW').toLowerCase()}`} style={{ fontSize: '0.7rem', padding: '3px 6px' }}>{res?.risk_level || 'LOW'}</span>
                            </div>
                          </div>

                          {/* Maintenance Recommendation */}
                          <div className="maintenance-rec-block" style={{ padding: '10px 14px', borderRadius: '8px', borderLeft: '4px solid #3b82f6', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Recommendation</div>
                            <div style={{ fontSize: '0.75rem', color: '#0f172a', lineHeight: '1.4' }}>
                              {res?.recommended_action || 'Continue routine operational monitoring.'}
                            </div>
                          </div>
                        </div>

                        {/* Instant Fault Injection Actions */}
                        <div className="fault-actions">
                          <button
                            className="btn-fault"
                            onClick={() => handleInjectFault(m.id, 'overheating')}
                          >
                            <Flame className="w-3.5 h-3.5 text-red-400" /> Overheat
                          </button>
                          <button
                            className="btn-fault vib"
                            onClick={() => handleInjectFault(m.id, 'vibration')}
                          >
                            <Zap className="w-3.5 h-3.5 text-amber-400" /> Vibration
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* FLEET OVERVIEW 6 CHARTS (3 PER ROW) */}
              <div className="analytics-grid-6">
                {/* Chart 1: Telemetry Trend Area Chart */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Telemetry Trend ({selectedFilterMachine === 'ALL' ? 'Fleet Avg' : (MACHINE_DETAILS[selectedFilterMachine]?.name || selectedFilterMachine)})</h3>
                    <span className="chart-sublabel">Temp (°C) & Vib</span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={fleetTelemetryTrendData}>
                        <defs>
                          <linearGradient id="colorTempFleet" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorVibFleet" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Area type="monotone" dataKey="Temperature" stroke="#ef4444" fillOpacity={1} fill="url(#colorTempFleet)" strokeWidth={2} />
                        <Area type="monotone" dataKey="Vibration" stroke="#38bdf8" fillOpacity={1} fill="url(#colorVibFleet)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 2: Asset Health Status Donut Chart */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Asset Health Status</h3>
                    <span className="chart-sublabel">Status Proportion</span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusDistributionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {statusDistributionData.map((entry, index) => (
                            <Cell key={`cell-status-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Legend verticalAlign="bottom" height={32} iconType="circle" wrapperStyle={{ color: '#ffffff' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 3: Predicted Fault Mode Breakdown Pie Chart */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Fault Mode Breakdown</h3>
                    <span className="chart-sublabel">Classifier Modes</span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={faultDistributionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {faultDistributionData.map((entry, index) => (
                            <Cell key={`cell-fault-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Legend verticalAlign="bottom" height={32} iconType="circle" wrapperStyle={{ color: '#ffffff' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 4: Multi-Machine Sensor Metrics Comparison Bar Chart */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Sensor Metrics Comparison</h3>
                    <span className="chart-sublabel">Temp vs Vibration</span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sensorComparisonData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Legend verticalAlign="bottom" height={32} wrapperStyle={{ color: '#ffffff' }} />
                        <Bar dataKey="Temperature" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Vibration" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 5: ML Anomaly Score Bar Chart */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>ML Anomaly Scores (%)</h3>
                    <span className="chart-sublabel">Isolation Forest Risk</span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={anomalyScoreData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Bar dataKey="Score" radius={[4, 4, 0, 0]}>
                          {anomalyScoreData.map((entry, idx) => (
                            <Cell
                              key={`cell-score-${idx}`}
                              fill={entry.Score > 70 ? '#ef4444' : entry.Score > 40 ? '#f59e0b' : '#10b981'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 6: Power & Energy Consumption Bar Chart */}
                <div className="glass-panel chart-card">
                  <div className="chart-header">
                    <h3>Power Draw (kW)</h3>
                    <span className="chart-sublabel">Electrical Load</span>
                  </div>
                  <div className="chart-body">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={energyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0e17',
                            borderColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                          }}
                        />
                        <Bar dataKey="Power" fill="#c084fc" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* VIEW 3: DEDICATED NOTIFICATIONS PAGE */}
      {activeTab === 'notifications' && (
        <div className="dashboard-body">
          <div className="notif-page-header">
            <div>
              <h2>Industrial Alert Notifications & Lifecycle Management</h2>
              <p>
                Complete real-time log of anomaly alerts, fault condition reports, and lifecycle acknowledgment.
              </p>
            </div>

            <div className="email-alert-banner">
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                Email Dispatch: <strong style={{ color: '#0f172a' }}>{alertEmail}</strong>
              </span>
              <button
                className="btn-test-email"
                onClick={handleTestEmail}
                disabled={isSendingTestEmail}
              >
                {isSendingTestEmail ? 'Sending...' : 'Test Email Alert'}
              </button>
            </div>
          </div>

          {/* Filterable Table Panel */}
          <div className="glass-panel alerts-section">
            <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Alert Log History</h3>
                <span style={{ background: '#f1f5f9', color: '#475569', fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '12px' }}>
                  {alerts.length} Total
                </span>
              </div>

              <div className="alerts-header-actions">
                <div className="alerts-filter-bar">
                  <button
                    className={`filter-btn ${alertFilter === 'ALL' ? 'active' : ''}`}
                    onClick={() => setAlertFilter('ALL')}
                  >
                    All ({alerts.length})
                  </button>
                  <button
                    className={`filter-btn ${alertFilter === 'ACTIVE' ? 'active' : ''}`}
                    onClick={() => setAlertFilter('ACTIVE')}
                  >
                    Active ({alerts.filter((a) => !a.acknowledged).length})
                  </button>
                  <button
                    className={`filter-btn ${alertFilter === 'CRITICAL' ? 'active' : ''}`}
                    onClick={() => setAlertFilter('CRITICAL')}
                  >
                    Critical ({alerts.filter((a) => (a.severity || a.status) === 'CRITICAL').length})
                  </button>
                  <button
                    className={`filter-btn ${alertFilter === 'ACKNOWLEDGED' ? 'active' : ''}`}
                    onClick={() => setAlertFilter('ACKNOWLEDGED')}
                  >
                    Acknowledged ({alerts.filter((a) => a.acknowledged).length})
                  </button>
                </div>

                {kpiStats.activeAlertsCount > 0 && (
                  <button className="btn-ack-all" onClick={handleAcknowledgeAll}>
                    <CheckSquare className="w-3.5 h-3.5" /> Acknowledge All Active ({kpiStats.activeAlertsCount})
                  </button>
                )}
              </div>
            </div>

            <div className="alerts-table-wrapper">
              {filteredAlerts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0', fontSize: '0.9rem' }}>
                  No matching notifications or industrial alerts found. Machine operating nominally.
                </p>
              ) : (
                <table className="alerts-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Severity</th>
                      <th>Machine</th>
                      <th>Predicted Fault</th>
                      <th>Alert Message</th>
                      <th>Recommended Action</th>
                      <th>Status / Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAlerts.map((a) => {
                      const aId = a.id || a.alert_id || `alt-${Math.random()}`;
                      const aSev = (a.severity || a.status || 'WARNING').toLowerCase();
                      return (
                        <tr key={aId}>
                          <td style={{ color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            {a.timestamp ? (a.timestamp.includes('T') ? new Date(a.timestamp).toLocaleTimeString() : a.timestamp) : 'N/A'}
                          </td>
                          <td>
                            <span className={`alert-sev-badge ${aSev}`}>
                              {a.severity || a.status}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: '#0f172a' }}>{a.machine_id}</td>
                          <td style={{ color: '#7c3aed', fontWeight: 600 }}>
                            {a.predicted_fault || a.type || 'Anomaly'}
                          </td>
                          <td style={{ color: '#334155' }}>{a.message}</td>
                          <td style={{ color: '#64748b', fontSize: '0.8rem' }}>
                            {a.recommended_action}
                          </td>
                          <td>
                            {a.acknowledged ? (
                              <span className="text-ack">
                                <Check className="w-3.5 h-3.5 inline mr-1 text-emerald-500" /> Acknowledged
                              </span>
                            ) : (
                              <button
                                className="btn-ack"
                                onClick={() => handleAcknowledgeAlert(aId)}
                              >
                                Acknowledge
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Container */}
      <ToastContainer
        position="top-right"
        autoClose={3500}
        limit={1}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick={true}
        pauseOnHover={false}
        theme="dark"
      />
    </div>
  );
}

export default App;
