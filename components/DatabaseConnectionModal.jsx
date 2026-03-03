/**
 * Database Connection Modal
 *
 * AI-triggered modal that appears when the AI needs database access.
 * Supports both Supabase and Neon providers.
 *
 * Flow:
 * 1. AI calls requestDatabaseConnection tool
 * 2. This modal appears with the AI's reason
 * 3. User enters connection string
 * 4. Connection is validated and stored
 * 5. AI workflow resumes automatically
 */

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Chip,
  Link,
  Collapse
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

export default function DatabaseConnectionModal({
  isOpen,
  onConnect,
  onCancel,
  aiPrompt,
  projectId
}) {
  const [provider, setProvider] = useState(aiPrompt?.suggestedProvider || 'supabase');
  const [connectionString, setConnectionString] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const handleProviderChange = (event, newProvider) => {
    if (newProvider) {
      setProvider(newProvider);
      setError(null);
      setValidationResult(null);
    }
  };

  const handleConnect = async () => {
    if (!connectionString.trim()) {
      setError('Please enter a connection string');
      return;
    }

    if (!connectionName.trim()) {
      setConnectionName(`My ${provider === 'supabase' ? 'Supabase' : 'Neon'} DB`);
    }

    setIsValidating(true);
    setError(null);

    try {
      const response = await fetch('/api/database/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          connectionName: connectionName.trim() || `My ${provider} DB`,
          connectionString: connectionString.trim(),
          projectId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Connection failed');
        if (result.hint) {
          setError(`${result.error}\n\nHint: ${result.hint}`);
        }
        return;
      }

      setValidationResult(result);

      // Call onConnect with the connection info
      setTimeout(() => {
        onConnect({
          success: true,
          connectionId: result.connection.id,
          provider: result.connection.provider,
          database: result.validation.database,
          message: `Connected to ${result.validation.database} on ${provider}`
        });
      }, 1000); // Brief delay to show success state

    } catch (err) {
      setError(err.message || 'Failed to connect');
    } finally {
      setIsValidating(false);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  const getProviderHelp = () => {
    if (provider === 'supabase') {
      return {
        title: 'Getting your Supabase connection string',
        steps: [
          'Go to your Supabase project dashboard',
          'Navigate to Project Settings → Database',
          'Copy the "Connection string" (use Transaction pooler)',
          'Replace [YOUR-PASSWORD] with your database password'
        ],
        docsUrl: 'https://supabase.com/docs/guides/database/connecting-to-postgres#direct-connection'
      };
    }
    return {
      title: 'Getting your Neon connection string',
      steps: [
        'Go to your Neon dashboard',
        'Select your project',
        'Click "Connection Details"',
        'Copy the connection string'
      ],
      docsUrl: 'https://neon.tech/docs/connect/connection-string'
    };
  };

  const help = getProviderHelp();

  return (
    <Dialog
      open={isOpen}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 2 }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon color="primary" />
        Database Connection Required
      </DialogTitle>

      <DialogContent>
        {/* AI's reason for needing database */}
        {aiPrompt?.reason && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>AI needs database access:</strong> {aiPrompt.reason}
            </Typography>
          </Alert>
        )}

        {/* Planned tables */}
        {aiPrompt?.plannedTables?.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Tables to create:
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {aiPrompt.plannedTables.map((table, i) => (
                <Chip
                  key={i}
                  label={table.name}
                  size="small"
                  title={table.purpose}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Provider selection */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Select your database provider:
        </Typography>

        <ToggleButtonGroup
          value={provider}
          exclusive
          onChange={handleProviderChange}
          fullWidth
          sx={{ mb: 2 }}
        >
          <ToggleButton value="supabase">
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" fontWeight="bold">Supabase</Typography>
              <Typography variant="caption" color="text.secondary">
                PostgreSQL + Auth + Realtime
              </Typography>
            </Box>
          </ToggleButton>
          <ToggleButton value="neon">
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" fontWeight="bold">Neon</Typography>
              <Typography variant="caption" color="text.secondary">
                Serverless PostgreSQL
              </Typography>
            </Box>
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Connection name */}
        <TextField
          fullWidth
          label="Connection Name"
          placeholder={`My ${provider === 'supabase' ? 'Supabase' : 'Neon'} Database`}
          value={connectionName}
          onChange={(e) => setConnectionName(e.target.value)}
          size="small"
          sx={{ mb: 2 }}
        />

        {/* Connection string input */}
        <TextField
          fullWidth
          label="Connection String"
          placeholder="postgresql://username:password@host:port/database"
          value={connectionString}
          onChange={(e) => {
            setConnectionString(e.target.value);
            setError(null);
            setValidationResult(null);
          }}
          multiline
          rows={2}
          error={!!error}
          helperText={error}
          sx={{ mb: 1 }}
        />

        {/* Help section */}
        <Button
          size="small"
          onClick={() => setShowHelp(!showHelp)}
          endIcon={showHelp ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ mb: 1 }}
        >
          {showHelp ? 'Hide' : 'Show'} help
        </Button>

        <Collapse in={showHelp}>
          <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              {help.title}
            </Typography>
            <ol style={{ margin: 0, paddingLeft: '1.2em' }}>
              {help.steps.map((step, i) => (
                <li key={i}>
                  <Typography variant="body2" color="text.secondary">
                    {step}
                  </Typography>
                </li>
              ))}
            </ol>
            <Link
              href={help.docsUrl}
              target="_blank"
              rel="noopener"
              variant="body2"
              sx={{ mt: 1, display: 'block' }}
            >
              View documentation →
            </Link>
          </Box>
        </Collapse>

        {/* Validation success */}
        {validationResult && (
          <Alert
            severity="success"
            icon={<CheckCircleIcon />}
            sx={{ mb: 1 }}
          >
            Connected to <strong>{validationResult.validation.database}</strong> as{' '}
            {validationResult.validation.connectedAs}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleCancel} disabled={isValidating}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConnect}
          disabled={isValidating || !connectionString.trim()}
          startIcon={isValidating ? <CircularProgress size={16} /> : null}
        >
          {isValidating ? 'Connecting...' : 'Connect & Continue'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
