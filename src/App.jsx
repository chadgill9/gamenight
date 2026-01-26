import React, { useState, useEffect, useCallback } from 'react';

// ============================================
// GLOBAL STYLES (inject keyframes)
// ============================================
const globalStyles = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fadeIn {
    animation: fadeIn 300ms ease forwards;
  }
  .animate-slideUp {
    animation: slideUp 400ms ease forwards;
  }
  .skeleton {
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
`;

// Inject styles once
if (typeof document !== 'undefined' && !document.getElementById('gn-styles')) {
  const style = document.createElement('style');
  style.id = 'gn-styles';
  style.textContent = globalStyles;
  document.head.appendChild(style);
}

// ============================================
// CONFIG
// ============================================
const SUPABASE_URL = 'https://gusjdcmqpdyqikqxxnli.supabase.co';
const API_BASE = `${SUPABASE_URL}/functions/v1`;

// ESPN API via Supabase proxy (avoids CORS issues)
const ESPN_PROXY = `${API_BASE}/espn-proxy`;

// ============================================
// ERROR LOGGING & MONITORING
// ============================================
const logError = async (error, context = {}) => {
  const errorData = {
    message: error?.message || String(error),
    stack: error?.stack,
    context,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    deviceId: localStorage.getItem('gn_device_id')
  };
  
  // Always log to console
  console.error('[Gamenight Error]', errorData);
  
  // Try to send to Supabase (fire and forget, don't block)
  try {
    fetch(`${API_BASE}/log-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errorData)
    }).catch(() => {}); // Silently fail if logging fails
  } catch (e) {
    // Ignore logging failures
  }
};

// Global error handler
window.onerror = (message, source, lineno, colno, error) => {
  logError(error || message, { source, lineno, colno, type: 'uncaught' });
};

// Unhandled promise rejection handler
window.onunhandledrejection = (event) => {
  logError(event.reason, { type: 'unhandledRejection' });
};

// Get or create device ID for anonymous users
const getDeviceId = () => {
  let deviceId = localStorage.getItem('gn_device_id');
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now();
    localStorage.setItem('gn_device_id', deviceId);
  }
  return deviceId;
};

// ============================================
// ESPN Data Transformer
// ============================================

// Check if game status indicates it's finished or not active
const isGameFinal = (status) => {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.includes('FINAL') || s.includes('POST') || s.includes('END') || s.includes('COMPLETE') || s.includes('POSTPONED') || s.includes('CANCELED') || s.includes('SUSPENDED');
};

// P0 FIX: Check if a game is still watchable (not finished)
// A game is watchable if it's scheduled or in progress
const isGameWatchable = (status) => {
  // No status usually means scheduled
  if (!status) return true;
  // If game is final/ended, it's NOT watchable
  return !isGameFinal(status);
};

// Check if game is in progress (live)
const isGameInProgress = (status) => {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.includes('IN_PROGRESS') || s.includes('LIVE') || s.includes('HALFTIME') || 
         s.includes('IN ') || (s.includes('STATUS_IN') && !s.includes('FINAL'));
};

// Check if game is postponed or cancelled (drastic event)
const isGamePostponedOrCancelled = (status) => {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.includes('POSTPONED') || s.includes('CANCELED') || s.includes('CANCELLED') || s.includes('SUSPENDED');
};

// ============================================
// PICK STATE MACHINE
// ============================================
// Manages the "Today's Pick" lifecycle:
// 1. Daily reset at 6 AM ET
// 2. Re-evaluation before pick starts
// 3. Freeze once pick starts/is in progress
// 4. Override only for drastic events

const PICK_STATE_KEY = 'gn_pick_state';
const PICK_LOCK_REASONS = {
  STARTED: 'STARTED',           // Game has started
  IN_PROGRESS: 'IN_PROGRESS',   // Game is live
  MANUAL: 'MANUAL',             // User manually locked (future feature)
};
const PICK_OVERRIDE_REASONS = {
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  REMOVED: 'REMOVED',           // Game no longer in slate
  DATA_INVALID: 'DATA_INVALID', // Critical data integrity issue
  DRASTIC_INJURY: 'DRASTIC_INJURY', // Both stars out + confidence collapse
};

// Get current time in Eastern Time
const getCurrentTimeET = () => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
};

// Get today's date string in ET (YYYY-MM-DD)
const getTodayDateStringET = () => {
  const etNow = getCurrentTimeET();
  const year = etNow.getFullYear();
  const month = String(etNow.getMonth() + 1).padStart(2, '0');
  const day = String(etNow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Check if it's past 6 AM ET (daily reset time)
const isPastDailyResetTime = () => {
  const etNow = getCurrentTimeET();
  return etNow.getHours() >= 6;
};

// Load pick state from localStorage
const loadPickState = (sport) => {
  try {
    const key = `${PICK_STATE_KEY}_${sport}`;
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (e) {
    console.warn('[Gamenight] Failed to load pick state:', e);
    return null;
  }
};

// Save pick state to localStorage
const savePickState = (sport, state) => {
  try {
    const key = `${PICK_STATE_KEY}_${sport}`;
    localStorage.setItem(key, JSON.stringify(state));
    console.log('[Gamenight] Pick state saved:', { sport, gameId: state.pickGameId, locked: state.pickLocked });
  } catch (e) {
    console.warn('[Gamenight] Failed to save pick state:', e);
  }
};

// Create initial pick state
const createPickState = (game, games, confidenceTier) => {
  const now = new Date().toISOString();
  return {
    pickDateET: getTodayDateStringET(),
    pickGameId: game.id,
    pickGame: game,
    pickLocked: false,
    pickLockedReason: null,
    pickChosenAt: now,
    lastEvaluatedAt: now,
    pickScoreAtSelection: game.score,
    pickConfidenceAtSelection: confidenceTier?.tier || 'WEAK',
    alternateGameIds: games.slice(1, 4).map(g => g.id), // Next 3 best games
  };
};

// Check if pick state needs daily reset
const needsDailyReset = (pickState) => {
  if (!pickState) return true;
  
  const todayET = getTodayDateStringET();
  
  // Different day = needs reset
  if (pickState.pickDateET !== todayET) return true;
  
  // Same day but before 6 AM when state was created, and now it's past 6 AM
  // This handles edge case where state was created at 5:59 AM
  if (!isPastDailyResetTime()) return false;
  
  // Check if pick was chosen before 6 AM today
  const chosenAt = new Date(pickState.pickChosenAt);
  const chosenHourET = new Date(chosenAt.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
  if (chosenHourET < 6 && isPastDailyResetTime()) {
    return true;
  }
  
  return false;
};

// Check if pick should be locked (game started or in progress)
const shouldLockPick = (pickState, currentGameData) => {
  if (!pickState || !currentGameData) return { shouldLock: false };
  
  // Already locked
  if (pickState.pickLocked) return { shouldLock: false };
  
  // Game is in progress
  if (isGameInProgress(currentGameData.status)) {
    return { shouldLock: true, reason: PICK_LOCK_REASONS.IN_PROGRESS };
  }
  
  // Game has started (check start time vs current time)
  if (currentGameData.startTime) {
    const startTime = new Date(currentGameData.startTime).getTime();
    const now = Date.now();
    if (now >= startTime) {
      return { shouldLock: true, reason: PICK_LOCK_REASONS.STARTED };
    }
  }
  
  // Game is final (shouldn't happen but handle it)
  if (isGameFinal(currentGameData.status)) {
    return { shouldLock: true, reason: PICK_LOCK_REASONS.STARTED };
  }
  
  return { shouldLock: false };
};

// Check if pick should be overridden (drastic events only)
const shouldOverridePick = (pickState, currentGameData, newBestGame, newConfidenceTier) => {
  if (!pickState || !currentGameData) return { shouldOverride: false };
  
  // 1. Game is postponed or cancelled
  if (isGamePostponedOrCancelled(currentGameData.status)) {
    return { 
      shouldOverride: true, 
      reason: currentGameData.status.toUpperCase().includes('CANCEL') 
        ? PICK_OVERRIDE_REASONS.CANCELLED 
        : PICK_OVERRIDE_REASONS.POSTPONED,
      message: `Pick updated: game ${getGameStatusText(currentGameData.status).toLowerCase()}`
    };
  }
  
  // 2. Game no longer in slate (removed/rescheduled)
  if (!currentGameData.id) {
    return { 
      shouldOverride: true, 
      reason: PICK_OVERRIDE_REASONS.REMOVED,
      message: 'Pick updated: game removed from schedule'
    };
  }
  
  // 3. Critical data integrity issue
  if (!currentGameData.homeTeam || !currentGameData.awayTeam) {
    return { 
      shouldOverride: true, 
      reason: PICK_OVERRIDE_REASONS.DATA_INVALID,
      message: 'Pick updated: data error'
    };
  }
  
  // 4. Drastic injury scenario (only if very strict conditions met)
  // This is OPTIONAL and very conservative
  if (newBestGame && newConfidenceTier) {
    const oldScore = pickState.pickScoreAtSelection || 0;
    const newBestScore = newBestGame.score || 0;
    const scoreDrop = oldScore - (currentGameData.score || 0);
    const scoreGap = newBestScore - (currentGameData.score || 0);
    
    // Must meet ALL conditions:
    // - Score dropped by 20+ points
    // - New best game is 20+ points better than current pick
    // - New best game has SOLID or better confidence
    // - Injury status is verified (we know this is real)
    if (scoreDrop >= 20 && 
        scoreGap >= 20 && 
        ['CLEAR', 'SOLID'].includes(newConfidenceTier.tier) &&
        currentGameData.validation?.injuryStatusVerified === true) {
      return {
        shouldOverride: true,
        reason: PICK_OVERRIDE_REASONS.DRASTIC_INJURY,
        message: 'Pick updated: significant lineup changes'
      };
    }
  }
  
  return { shouldOverride: false };
};

// Evaluate and update pick state
const evaluatePick = (pickState, games, confidenceTier, sport) => {
  const now = new Date().toISOString();
  const watchableGames = games.filter(g => isGameWatchable(g.status));
  const rankedGames = rankGamesByWatchability(watchableGames);
  
  // No watchable games
  if (rankedGames.length === 0) {
    return {
      pickState: null,
      pick: null,
      message: `All ${sport.toUpperCase()} games have finished`,
      wasOverridden: false
    };
  }
  
  const newBestGame = rankedGames[0];
  
  // CASE 1: No existing pick state or needs daily reset
  if (!pickState || needsDailyReset(pickState)) {
    const newState = createPickState(newBestGame, rankedGames, confidenceTier);
    savePickState(sport, newState);
    console.log('[Gamenight] New pick selected:', { 
      gameId: newBestGame.id, 
      score: newBestGame.score,
      reason: !pickState ? 'no_prior_state' : 'daily_reset'
    });
    return {
      pickState: newState,
      pick: newBestGame,
      message: null,
      wasOverridden: false,
      isNewPick: true
    };
  }
  
  // Find current pick's game in today's slate
  const currentPickGame = games.find(g => g.id === pickState.pickGameId);
  
  // CASE 2: Current pick game not found in slate
  if (!currentPickGame) {
    const override = shouldOverridePick(pickState, { id: null }, newBestGame, confidenceTier);
    if (override.shouldOverride) {
      const newState = createPickState(newBestGame, rankedGames, confidenceTier);
      newState.overrideReason = override.reason;
      newState.overrideMessage = override.message;
      savePickState(sport, newState);
      console.log('[Gamenight] Pick overridden (game removed):', { 
        oldGameId: pickState.pickGameId,
        newGameId: newBestGame.id 
      });
      return {
        pickState: newState,
        pick: newBestGame,
        message: override.message,
        wasOverridden: true
      };
    }
  }
  
  // CASE 3: Check if pick should be locked
  const lockCheck = shouldLockPick(pickState, currentPickGame);
  if (lockCheck.shouldLock) {
    const lockedState = {
      ...pickState,
      pickLocked: true,
      pickLockedReason: lockCheck.reason,
      pickGame: currentPickGame, // Update with latest game data
      lastEvaluatedAt: now
    };
    savePickState(sport, lockedState);
    console.log('[Gamenight] Pick locked:', { 
      gameId: pickState.pickGameId, 
      reason: lockCheck.reason 
    });
    return {
      pickState: lockedState,
      pick: currentPickGame,
      message: null,
      wasOverridden: false,
      wasLocked: true
    };
  }
  
  // CASE 4: Pick is already locked - check for drastic override only
  if (pickState.pickLocked) {
    const override = shouldOverridePick(pickState, currentPickGame, newBestGame, confidenceTier);
    if (override.shouldOverride) {
      const newState = createPickState(newBestGame, rankedGames, confidenceTier);
      newState.overrideReason = override.reason;
      newState.overrideMessage = override.message;
      savePickState(sport, newState);
      console.log('[Gamenight] Locked pick overridden:', { 
        oldGameId: pickState.pickGameId,
        newGameId: newBestGame.id,
        reason: override.reason
      });
      return {
        pickState: newState,
        pick: newBestGame,
        message: override.message,
        wasOverridden: true
      };
    }
    
    // Locked and no override needed - return current pick with updated game data
    const updatedState = {
      ...pickState,
      pickGame: currentPickGame,
      lastEvaluatedAt: now
    };
    savePickState(sport, updatedState);
    return {
      pickState: updatedState,
      pick: currentPickGame,
      message: null,
      wasOverridden: false
    };
  }
  
  // CASE 5: Pick is NOT locked - can re-evaluate freely
  // Pick the best watchable game
  if (newBestGame.id !== pickState.pickGameId) {
    // Better game available - update pick (before lock)
    const newState = createPickState(newBestGame, rankedGames, confidenceTier);
    savePickState(sport, newState);
    console.log('[Gamenight] Pick re-evaluated (pre-lock):', { 
      oldGameId: pickState.pickGameId,
      newGameId: newBestGame.id,
      oldScore: pickState.pickScoreAtSelection,
      newScore: newBestGame.score
    });
    return {
      pickState: newState,
      pick: newBestGame,
      message: null,
      wasOverridden: false,
      wasReEvaluated: true
    };
  }
  
  // Same game still best - update state with latest data
  const updatedState = {
    ...pickState,
    pickGame: currentPickGame,
    lastEvaluatedAt: now,
    alternateGameIds: rankedGames.slice(1, 4).map(g => g.id)
  };
  savePickState(sport, updatedState);
  return {
    pickState: updatedState,
    pick: currentPickGame,
    message: null,
    wasOverridden: false
  };
};

// Get display text for game status
const getGameStatusText = (status) => {
  if (!status) return 'Live';
  const s = status.toUpperCase();
  if (s.includes('FINAL')) return 'Final';
  if (s.includes('POSTPONED')) return 'Postponed';
  if (s.includes('CANCELED')) return 'Canceled';
  if (s.includes('SUSPENDED')) return 'Suspended';
  if (s.includes('DELAYED')) return 'Delayed';
  return 'Live';
};

// ============================================
// DATE VALIDATION (P0 - Stale Data Prevention)
// ============================================
// CRITICAL: All games must be validated as "today's" games
// Prevents showing yesterday's picks or stale data

// Get today's date in Eastern Time (sports standard timezone)
// Returns YYYY-MM-DD format to match ESPN gameDate format
// ============================================
// CENTRALIZED GAME RANKING (P0 FIX)
// ============================================
// This function is the ONLY place games should be sorted.
// Status NEVER affects ranking. Only score and startTime (as tie-breaker).
const rankGamesByWatchability = (games) => {
  if (!games || !Array.isArray(games)) return [];
  
  // CRITICAL: Create new array to avoid mutation
  return [...games].sort((a, b) => {
    // PRIMARY: watchabilityScore (descending)
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    
    // SECONDARY (tie-break only): scheduled start time (earlier first)
    // This ensures stable ordering when scores are equal
    const timeA = new Date(a.startTime || 0).getTime();
    const timeB = new Date(b.startTime || 0).getTime();
    return timeA - timeB;
  });
};

const getTodayDateET = () => {
  const now = new Date();
  // Format in Eastern Time
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = etDate.getFullYear();
  const month = String(etDate.getMonth() + 1).padStart(2, '0');
  const day = String(etDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ============================================
// DATE CLASSIFICATION (NOT FILTERING)
// ============================================
// CRITICAL: Games must be CLASSIFIED, not FILTERED
// A game's eligibility is determined by its ET date, not UTC date
// 
// Classifications:
// - TODAY_ET: Game starts today in Eastern Time (eligible for Today's Pick)
// - LATE_NIGHT_ET: Game starts after midnight UTC but same ET day (eligible)
// - TOMORROW_ET: Game starts tomorrow in ET (not eligible for today's pick)
// - YESTERDAY_ET: Game started yesterday in ET (likely finished)
// - INVALID_DATE: No valid date provided

const DATE_CLASSIFICATIONS = {
  TODAY_ET: 'TODAY_ET',
  LATE_NIGHT_ET: 'LATE_NIGHT_ET', // After midnight UTC, same ET day
  TOMORROW_ET: 'TOMORROW_ET',
  YESTERDAY_ET: 'YESTERDAY_ET',
  INVALID_DATE: 'INVALID_DATE'
};

// Convert a UTC timestamp to Eastern Time date string (YYYY-MM-DD)
const convertUTCToET = (utcTimestamp) => {
  if (!utcTimestamp) return null;
  try {
    const date = new Date(utcTimestamp);
    if (isNaN(date.getTime())) return null;
    
    // Convert to Eastern Time
    const etDateStr = date.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    // Parse MM/DD/YYYY to YYYY-MM-DD
    const [month, day, year] = etDateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } catch (e) {
    console.warn('[Gamenight] Failed to convert UTC to ET:', utcTimestamp, e);
    return null;
  }
};

// Get full ET datetime info for a UTC timestamp
const getETDateTimeInfo = (utcTimestamp) => {
  if (!utcTimestamp) return null;
  try {
    const date = new Date(utcTimestamp);
    if (isNaN(date.getTime())) return null;
    
    // Get ET components
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    
    const getPart = (type) => etParts.find(p => p.type === type)?.value;
    
    return {
      year: getPart('year'),
      month: getPart('month'),
      day: getPart('day'),
      hour: parseInt(getPart('hour')),
      minute: parseInt(getPart('minute')),
      dateString: `${getPart('year')}-${getPart('month')}-${getPart('day')}`
    };
  } catch (e) {
    return null;
  }
};

// Classify a game's date relative to today (in ET)
// This CLASSIFIES games, it does NOT filter them
const classifyGameDate = (startTimeUTC) => {
  const todayET = getTodayDateET();
  
  // No date provided
  if (!startTimeUTC) {
    return {
      classification: DATE_CLASSIFICATIONS.INVALID_DATE,
      gameDateET: null,
      gameDateUTC: null,
      todayET,
      eligibleForTodayPick: false,
      reason: 'NO_DATE_PROVIDED'
    };
  }
  
  // Convert UTC start time to ET date
  const gameDateET = convertUTCToET(startTimeUTC);
  const gameDateUTC = startTimeUTC.split('T')[0]; // For logging only
  
  if (!gameDateET) {
    return {
      classification: DATE_CLASSIFICATIONS.INVALID_DATE,
      gameDateET: null,
      gameDateUTC,
      todayET,
      eligibleForTodayPick: false,
      reason: 'INVALID_DATE_FORMAT'
    };
  }
  
  // Parse dates for comparison
  const today = new Date(todayET + 'T12:00:00'); // Noon to avoid DST issues
  const gameDay = new Date(gameDateET + 'T12:00:00');
  const diffDays = Math.round((gameDay - today) / (1000 * 60 * 60 * 24));
  
  // Get ET time info for late-night detection
  const etInfo = getETDateTimeInfo(startTimeUTC);
  
  let classification;
  let eligibleForTodayPick;
  let reason;
  
  if (diffDays === 0) {
    // Same day in ET
    classification = DATE_CLASSIFICATIONS.TODAY_ET;
    eligibleForTodayPick = true;
    reason = 'SAME_DAY_ET';
  } else if (diffDays === -1) {
    // Yesterday in ET (might be a late game still showing, or finished)
    classification = DATE_CLASSIFICATIONS.YESTERDAY_ET;
    eligibleForTodayPick = false;
    reason = 'YESTERDAY_ET';
  } else if (diffDays === 1) {
    // Tomorrow in ET - but check if it's actually late tonight in UTC
    // A game at 11:30 PM ET would be UTC next day but still "today"
    // This shouldn't happen if we convert properly, but handle edge case
    classification = DATE_CLASSIFICATIONS.TOMORROW_ET;
    eligibleForTodayPick = false;
    reason = 'TOMORROW_ET';
  } else if (diffDays > 1) {
    classification = DATE_CLASSIFICATIONS.TOMORROW_ET;
    eligibleForTodayPick = false;
    reason = 'FUTURE_GAME';
  } else {
    classification = DATE_CLASSIFICATIONS.YESTERDAY_ET;
    eligibleForTodayPick = false;
    reason = 'PAST_GAME';
  }
  
  return {
    classification,
    gameDateET,
    gameDateUTC,
    todayET,
    eligibleForTodayPick,
    reason,
    etHour: etInfo?.hour,
    etMinute: etInfo?.minute
  };
};

// LEGACY WRAPPER: For backward compatibility with existing code
// Returns { isToday } for code that expects the old format
const validateGameDate = (gameDate, startTimeUTC = null) => {
  // If we have startTimeUTC, use proper classification
  if (startTimeUTC) {
    const classification = classifyGameDate(startTimeUTC);
    return {
      isToday: classification.eligibleForTodayPick,
      gameDate: classification.gameDateET,
      todayDate: classification.todayET,
      reason: classification.reason,
      classification: classification.classification
    };
  }
  
  // Fallback for code that only passes gameDate (deprecated)
  // This is the OLD buggy logic - only kept for transition
  const todayDate = getTodayDateET();
  return {
    isToday: gameDate === todayDate,
    gameDate,
    todayDate,
    reason: gameDate === todayDate ? 'VALID' : 'DATE_MISMATCH_LEGACY'
  };
};

// ============================================
// DATA FRESHNESS VALIDATION (HARD FIX #2)
// ============================================
// CRITICAL: Data can be from today but still stale
// E.g., fetched at 6am, now 7pm - lineups changed, injuries updated

// Staleness thresholds (in minutes)
const DATA_FRESHNESS_THRESHOLDS = {
  SCHEDULED: 60,   // Games not started: 1 hour is acceptable
  LIVE: 5,         // Games in progress: 5 minutes max
  DEFAULT: 30      // Unknown status: 30 minutes
};

// Calculate data age in minutes from fetch timestamp
const getDataAgeMinutes = (fetchTimestamp) => {
  if (!fetchTimestamp) return Infinity; // No timestamp = infinitely stale
  
  try {
    const fetchTime = new Date(fetchTimestamp).getTime();
    const now = Date.now();
    const ageMs = now - fetchTime;
    return Math.round(ageMs / (1000 * 60)); // Convert to minutes
  } catch (e) {
    console.warn('[Gamenight] Invalid fetch timestamp:', fetchTimestamp);
    return Infinity;
  }
};

// Check if data freshness is acceptable for the game state
// Returns { fresh: boolean, ageMinutes: number, threshold: number, status: string }
const validateDataFreshness = (fetchTimestamp, gameStatus = 'scheduled') => {
  const ageMinutes = getDataAgeMinutes(fetchTimestamp);
  
  // Determine threshold based on game status
  let threshold;
  if (!gameStatus || gameStatus.toUpperCase().includes('SCHEDULED')) {
    threshold = DATA_FRESHNESS_THRESHOLDS.SCHEDULED;
  } else if (gameStatus.toUpperCase().includes('FINAL') || gameStatus.toUpperCase().includes('POST')) {
    threshold = DATA_FRESHNESS_THRESHOLDS.SCHEDULED; // Finished games don't need fresh data
  } else {
    // Assume live or in-progress
    threshold = DATA_FRESHNESS_THRESHOLDS.LIVE;
  }
  
  const fresh = ageMinutes <= threshold;
  
  if (!fresh) {
    console.warn(`[Gamenight] Data is stale: ${ageMinutes} minutes old (threshold: ${threshold})`);
  }
  
  return {
    fresh,
    ageMinutes,
    threshold,
    status: fresh ? 'FRESH' : 'STALE'
  };
};

// ============================================
// WATCHABILITY ALGORITHM v2
// ============================================

// ============================================
// SPORT-ISOLATED PLAYER DATABASES
// ============================================
// CRITICAL: Each sport has its own isolated player data
// NEVER share or cross-reference between sports
// All players must be ACTIVE for current season
// NOTE: Static lists are best-effort as of last update. 
//       Injury cache provides real-time filtering when available.

// ============================================
// INJURY CACHE (HARD FIX #1)
// ============================================
// This cache stores known player availability status.
// Populated when team rosters are fetched.
// Used to EXCLUDE players from matchup selection.

// Status values that mean player is OUT and should be excluded
const UNAVAILABLE_STATUSES = [
  'Out', 'OUT', 
  'Injured Reserve', 'IR',
  'Doubtful', 'DOUBTFUL',
  'Suspended', 'SUSPENDED',
  'Not With Team', 'NWT',
  'Physically Unable to Perform', 'PUP',
  'Non-Football Injury', 'NFI',
  'Day-To-Day', // Conservative: exclude day-to-day too
];

// Statuses that mean player is likely available
const AVAILABLE_STATUSES = [
  'Active', 'active', 'ACTIVE',
  'Probable', 'PROBABLE',
  'Healthy', 'HEALTHY',
];

// Global injury cache: { 'sport:teamAbbr:playerName': { status, updatedAt, onRoster } }
const INJURY_CACHE = {};

// HARD FIX #3: Track which team rosters we've verified
// { 'sport:teamAbbr': { updatedAt, playerNames: Set } }
const ROSTER_CACHE = {};

// Update injury cache when roster data is fetched
// HARD FIX #3: Also tracks roster membership
const updateInjuryCache = (teamAbbr, sport, roster) => {
  if (!teamAbbr || !sport || !Array.isArray(roster)) return;
  
  const now = Date.now();
  const rosterKey = `${sport}:${teamAbbr}`;
  const playerNames = new Set();
  
  roster.forEach(player => {
    if (player.name) {
      const key = `${sport}:${teamAbbr}:${player.name}`;
      playerNames.add(player.name);
      INJURY_CACHE[key] = {
        status: player.status || 'Active',
        injuryType: player.injuryType || null,
        onRoster: true, // HARD FIX #3: Confirmed on roster
        updatedAt: now
      };
    }
  });
  
  // HARD FIX #3: Track that we've verified this team's roster
  ROSTER_CACHE[rosterKey] = {
    updatedAt: now,
    playerNames,
    playerCount: roster.length
  };
  
  console.log(`[Gamenight] Roster cache updated for ${rosterKey}: ${roster.length} players`);
};

// Check if a player is available for matchup selection
// HARD FIX #3: Also checks roster membership when roster data is available
// Returns: { available: boolean, verified: boolean, status: string, onRoster: boolean }
const isPlayerAvailableForMatchup = (playerName, teamAbbr, sport) => {
  if (!playerName || !teamAbbr || !sport) {
    return { available: false, verified: false, status: 'INVALID_INPUT', onRoster: false };
  }
  
  const rosterKey = `${sport}:${teamAbbr}`;
  const playerKey = `${sport}:${teamAbbr}:${playerName}`;
  const cached = INJURY_CACHE[playerKey];
  const rosterData = ROSTER_CACHE[rosterKey];
  
  // HARD FIX #3: Check if we have roster data for this team
  if (rosterData) {
    const rosterAge = Date.now() - rosterData.updatedAt;
    const rosterIsStale = rosterAge > 4 * 60 * 60 * 1000; // 4 hours
    
    // If roster is recent and player is NOT on it, they're not available
    if (!rosterIsStale && !rosterData.playerNames.has(playerName)) {
      console.log(`[Gamenight] Player excluded (not on roster): ${playerName} for ${teamAbbr}`);
      return { available: false, verified: true, status: 'NOT_ON_ROSTER', onRoster: false };
    }
  }
  
  if (!cached) {
    // Player not in cache - we don't know their status
    // Return available but unverified (allows display with reduced confidence)
    return { available: true, verified: false, status: 'UNKNOWN', onRoster: false };
  }
  
  // Check if cache is stale (> 4 hours old)
  const cacheAge = Date.now() - cached.updatedAt;
  const isStale = cacheAge > 4 * 60 * 60 * 1000; // 4 hours
  
  // Check if player is unavailable
  if (UNAVAILABLE_STATUSES.includes(cached.status)) {
    console.log(`[Gamenight] Player excluded (${cached.status}): ${playerName}`);
    return { available: false, verified: !isStale, status: cached.status };
  }
  
  // Check if player is confirmed available
  if (AVAILABLE_STATUSES.includes(cached.status)) {
    return { available: true, verified: !isStale, status: cached.status };
  }
  
  // Unknown status - be conservative, treat as questionable
  // Allow but mark unverified
  return { available: true, verified: false, status: cached.status };
};

// Filter a list of players to only those available for matchup
// Returns: { availablePlayers: string[], hasUnverifiedPlayers: boolean }
const filterAvailablePlayers = (players, teamAbbr, sport) => {
  if (!Array.isArray(players) || players.length === 0) {
    return { availablePlayers: [], hasUnverifiedPlayers: false };
  }
  
  let hasUnverifiedPlayers = false;
  const availablePlayers = players.filter(playerName => {
    const { available, verified } = isPlayerAvailableForMatchup(playerName, teamAbbr, sport);
    if (!verified) hasUnverifiedPlayers = true;
    return available;
  });
  
  return { availablePlayers, hasUnverifiedPlayers };
};

// ============================================
// STATIC PLAYER DATA (Best-effort, last updated Jan 2025)
// ============================================

// === NBA PLAYERS (2024-25 Season) ===
const NBA_PLAYERS = {
  MVP_TIER: ['LeBron James', 'Stephen Curry', 'Giannis Antetokounmpo', 'Nikola Jokic', 'Luka Doncic', 
             'Joel Embiid', 'Jayson Tatum', 'Kevin Durant', 'Shai Gilgeous-Alexander', 'Anthony Edwards'],
  
  ALL_STAR: ['Donovan Mitchell', 'Trae Young', 'Tyrese Haliburton', 'Ja Morant', 'De\'Aaron Fox',
             'Devin Booker', 'Kyrie Irving', 'Jimmy Butler', 'Bam Adebayo', 'Paolo Banchero',
             'Jaylen Brown', 'Domantas Sabonis', 'LaMelo Ball', 'Cade Cunningham', 'Jalen Brunson',
             'Karl-Anthony Towns', 'Julius Randle', 'Damian Lillard', 'Victor Wembanyama', 'Zion Williamson',
             'Alperen Sengun', 'Franz Wagner', 'Scottie Barnes', 'Desmond Bane', 'Tyler Herro'],
  
  // NBA Team abbreviations → Active stars (2024-25)
  TEAM_STARS: {
    'LAL': ['LeBron James'], 
    'GSW': ['Stephen Curry'], 
    'MIL': ['Giannis Antetokounmpo', 'Damian Lillard'],
    'DEN': ['Nikola Jokic'], 
    'DAL': ['Luka Doncic', 'Kyrie Irving'], 
    'PHI': ['Joel Embiid'],
    'BOS': ['Jayson Tatum', 'Jaylen Brown'], 
    'PHX': ['Kevin Durant', 'Devin Booker'],
    'OKC': ['Shai Gilgeous-Alexander'], 
    'MIN': ['Anthony Edwards', 'Julius Randle'],
    'CLE': ['Donovan Mitchell'], 
    'ATL': ['Trae Young'], 
    'IND': ['Tyrese Haliburton'],
    'MEM': ['Ja Morant', 'Desmond Bane'], 
    'SAC': ['De\'Aaron Fox', 'Domantas Sabonis'],
    'MIA': ['Jimmy Butler', 'Bam Adebayo', 'Tyler Herro'], 
    'ORL': ['Paolo Banchero', 'Franz Wagner'],
    'CHA': ['LaMelo Ball'], 
    'DET': ['Cade Cunningham'], 
    'NYK': ['Jalen Brunson', 'Karl-Anthony Towns'],
    'SAS': ['Victor Wembanyama'],
    'NOP': ['Zion Williamson'], 
    'HOU': ['Alperen Sengun'],
    'TOR': ['Scottie Barnes'], 
    'LAC': [], 
    'BKN': [], 
    'CHI': [], 
    'WAS': [], 
    'POR': [],
    'UTA': []
  }
};

// === NFL PLAYERS (2024-25 Season) ===
// NOTE: Aaron Donald RETIRED - removed from active roster
const NFL_PLAYERS = {
  MVP_TIER: ['Patrick Mahomes', 'Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Jalen Hurts',
             'Travis Kelce', 'Tyreek Hill', 'Justin Jefferson', 'CeeDee Lamb', 'Ja\'Marr Chase'],
  
  ALL_PRO: ['Micah Parsons', 'T.J. Watt', 'Nick Bosa', 'Myles Garrett', 
            'Derrick Henry', 'Saquon Barkley', 'Christian McCaffrey', 'Davante Adams', 'A.J. Brown',
            'Amon-Ra St. Brown', 'Garrett Wilson', 'George Kittle', 'Tua Tagovailoa', 'Dak Prescott',
            'Jordan Love', 'Brock Purdy', 'C.J. Stroud', 'Caleb Williams'],
  
  // NFL Team abbreviations → Active stars (2024-25)
  TEAM_STARS: {
    'KC': ['Patrick Mahomes', 'Travis Kelce'], 
    'BUF': ['Josh Allen'], 
    'BAL': ['Lamar Jackson'],
    'CIN': ['Joe Burrow', 'Ja\'Marr Chase'], 
    'SF': ['Brock Purdy', 'Nick Bosa', 'Christian McCaffrey'],
    'MIA': ['Tyreek Hill', 'Tua Tagovailoa'], 
    'MIN': ['Justin Jefferson'],
    'DAL': ['CeeDee Lamb', 'Micah Parsons', 'Dak Prescott'], 
    'PHI': ['Jalen Hurts', 'A.J. Brown', 'Saquon Barkley'],
    'PIT': ['T.J. Watt'], 
    'CLE': ['Myles Garrett'], 
    'DET': ['Amon-Ra St. Brown'],
    'GB': ['Jordan Love'], 
    'HOU': ['C.J. Stroud'], 
    'CHI': ['Caleb Williams'],
    'NYJ': ['Garrett Wilson'], 
    'LV': ['Davante Adams'], 
    'TEN': ['Derrick Henry'],
    'LAR': [], // Aaron Donald RETIRED - no current stars
    'SEA': [], // No current star-tier players
    'ARI': [], 
    'CAR': [], 
    'TB': [], 
    'NO': [],
    'ATL': [], 
    'NYG': [], 
    'WAS': [], 
    'NE': [], 
    'IND': [], 
    'JAX': [], 
    'DEN': [], 
    'LAC': []
  },
  
  // QB mapping for NFL-specific logic
  TEAM_QBS: {
    'KC': 'Patrick Mahomes', 'BUF': 'Josh Allen', 'BAL': 'Lamar Jackson', 'CIN': 'Joe Burrow',
    'PHI': 'Jalen Hurts', 'MIA': 'Tua Tagovailoa', 'DAL': 'Dak Prescott', 'GB': 'Jordan Love',
    'SF': 'Brock Purdy', 'HOU': 'C.J. Stroud', 'CHI': 'Caleb Williams',
    // Teams without star QBs
    'MIN': null, 'DET': null, 'CLE': null, 'PIT': null, 'NYJ': null, 'LV': null, 'TEN': null,
    'LAR': null, 'SEA': null, 'ARI': null, 'CAR': null, 'TB': null, 'NO': null, 'ATL': null,
    'NYG': null, 'WAS': null, 'NE': null, 'IND': null, 'JAX': null, 'DEN': null, 'LAC': null
  }
};

// === MLB PLAYERS (2024 Season) ===
const MLB_PLAYERS = {
  MVP_TIER: ['Shohei Ohtani', 'Mookie Betts', 'Ronald Acuña Jr.', 'Corey Seager', 'Freddie Freeman',
             'Aaron Judge', 'Juan Soto', 'Bryce Harper', 'Mike Trout', 'Trea Turner'],
  
  ALL_STAR: ['Manny Machado', 'Fernando Tatis Jr.', 'Julio Rodriguez', 'Bobby Witt Jr.', 'Gunnar Henderson',
             'Marcus Semien', 'Jose Ramirez', 'Vladimir Guerrero Jr.', 'Bo Bichette', 'Rafael Devers',
             'Yordan Alvarez', 'Kyle Tucker', 'Corbin Carroll', 'Elly De La Cruz', 'Matt Olson'],
  
  ACE_PITCHERS: [
    'Gerrit Cole', 'Spencer Strider', 'Zack Wheeler', 'Corbin Burnes',
    'Dylan Cease', 'Tarik Skubal', 'Logan Webb', 'Yoshinobu Yamamoto', 'Tyler Glasnow',
    'Zac Gallen', 'Kevin Gausman', 'Blake Snell', 'Justin Verlander', 'Max Scherzer'
  ],
  
  // MLB Team abbreviations → Active stars (2024)
  TEAM_STARS: {
    'LAD': ['Shohei Ohtani', 'Mookie Betts', 'Freddie Freeman'], 
    'NYY': ['Aaron Judge', 'Juan Soto'],
    'ATL': ['Ronald Acuña Jr.', 'Matt Olson'], 
    'TEX': ['Corey Seager', 'Marcus Semien'],
    'PHI': ['Bryce Harper', 'Trea Turner'], 
    'LAA': ['Mike Trout'],
    'SD': ['Manny Machado', 'Fernando Tatis Jr.'], 
    'SEA': ['Julio Rodriguez'],
    'KC': ['Bobby Witt Jr.'], 
    'BAL': ['Gunnar Henderson'], 
    'CLE': ['Jose Ramirez'],
    'TOR': ['Vladimir Guerrero Jr.', 'Bo Bichette'], 
    'BOS': ['Rafael Devers'],
    'HOU': ['Yordan Alvarez', 'Kyle Tucker'], 
    'ARI': ['Corbin Carroll'],
    'CIN': ['Elly De La Cruz'], 
    'SF': [], 
    'CHC': [], 
    'STL': [], 
    'MIL': [], 
    'NYM': [],
    'TB': [], 
    'MIN': [], 
    'DET': [], 
    'CHW': [], 
    'OAK': [], 
    'MIA': [], 
    'COL': [], 
    'PIT': [], 
    'WAS': []
  }
};

// ============================================
// SPORT-SCOPED PLAYER LOOKUP (CRITICAL)
// ============================================
// This is the ONLY way to get players for a game
// Enforces complete sport isolation

const getPlayersForTeam = (teamAbbr, sport) => {
  // HARD GUARD: Must have valid sport
  if (!sport || !teamAbbr) return [];
  
  // Sport-specific lookup - NO CROSS-CONTAMINATION
  if (sport === 'nba') {
    return NBA_PLAYERS.TEAM_STARS[teamAbbr] || [];
  } else if (sport === 'nfl') {
    return NFL_PLAYERS.TEAM_STARS[teamAbbr] || [];
  } else if (sport === 'mlb') {
    return MLB_PLAYERS.TEAM_STARS[teamAbbr] || [];
  }
  
  // Unknown sport - return empty (fail safe)
  return [];
};

const getStarTiers = (sport) => {
  // HARD GUARD: Sport-specific tiers only
  if (sport === 'nfl') {
    return { mvp: NFL_PLAYERS.MVP_TIER, allStar: NFL_PLAYERS.ALL_PRO };
  } else if (sport === 'mlb') {
    return { mvp: MLB_PLAYERS.MVP_TIER, allStar: MLB_PLAYERS.ALL_STAR };
  } else if (sport === 'nba') {
    return { mvp: NBA_PLAYERS.MVP_TIER, allStar: NBA_PLAYERS.ALL_STAR };
  }
  // Unknown sport - return empty arrays (fail safe)
  return { mvp: [], allStar: [] };
};

const getNFLTeamQB = (teamAbbr) => {
  return NFL_PLAYERS.TEAM_QBS[teamAbbr] || null;
};

const isMLBAcePitcher = (pitcherName) => {
  return MLB_PLAYERS.ACE_PITCHERS.includes(pitcherName);
};

// Historic Rivalries (all sports)
const RIVALRIES = {
  // === NBA ===
  'BOS-LAL': 3, 'LAL-BOS': 3, // Historic
  'CHI-DET': 2, 'DET-CHI': 2, // Bad Boys era
  'GSW-CLE': 2, 'CLE-GSW': 2, // Finals rivalry
  'LAC-LAL': 2, 'LAL-LAC': 2, // Battle of LA
  'BOS-PHI': 2, 'PHI-BOS': 2, // Atlantic rivalry
  'DAL-HOU': 2, 'HOU-DAL': 2, // Texas rivalry
  'DAL-SA': 2, 'SA-DAL': 2,   // Texas rivalry
  'NY-BKN': 2, 'BKN-NY': 2,   // NYC rivalry
  'NYK-BKN': 2, 'BKN-NYK': 2, // NYC rivalry
  'MIA-BOS': 2, 'BOS-MIA': 2, // Playoff history
  'GSW-LAL': 1, 'LAL-GSW': 1, // California
  'PHX-LAL': 1, 'LAL-PHX': 1, // West rivalry
  
  // === NFL ===
  'DAL-WAS': 3, 'WAS-DAL': 3, // NFC East historic
  'GB-CHI': 3, 'CHI-GB': 3,   // Oldest rivalry
  'BAL-PIT': 3, 'PIT-BAL': 3, // AFC North
  'KC-LV': 2, 'LV-KC': 2,     // AFC West
  'SF-LAR': 2, 'LAR-SF': 2,   // NFC West
  'SF-SEA': 2, 'SEA-SF': 2,   // NFC West
  'NE-NYJ': 2, 'NYJ-NE': 2,   // AFC East
  'DAL-PHI': 2, 'PHI-DAL': 2, // NFC East
  'NYG-PHI': 2, 'PHI-NYG': 2, // NFC East
  'MIN-GB': 2, 'GB-MIN': 2,   // NFC North
  'CIN-CLE': 2, 'CLE-CIN': 2, // Ohio
  'DEN-KC': 1, 'KC-DEN': 1,   // AFC West
  'TB-NO': 1, 'NO-TB': 1,     // NFC South
  
  // === MLB ===
  'NYY-BOS': 3, 'BOS-NYY': 3, // Greatest rivalry
  'LAD-SF': 3, 'SF-LAD': 3,   // West coast historic
  'CHC-STL': 3, 'STL-CHC': 3, // Central rivalry
  'NYY-NYM': 2, 'NYM-NYY': 2, // Subway Series
  'LAD-SD': 2, 'SD-LAD': 2,   // SoCal
  'LAA-LAD': 2, 'LAD-LAA': 2, // Freeway Series
  'ATL-NYM': 1, 'NYM-ATL': 1, // NL East
  'HOU-TEX': 2, 'TEX-HOU': 2, // Texas
  'CLE-DET': 1, 'DET-CLE': 1, // Central
  'PHI-NYM': 1, 'NYM-PHI': 1, // NL East
};

// Division mappings for division matchup detection (all sports)
const DIVISIONS = {
  // NBA
  NBA_ATLANTIC: ['BOS', 'BKN', 'NY', 'NYK', 'PHI', 'TOR'],
  NBA_CENTRAL: ['CHI', 'CLE', 'DET', 'IND', 'MIL'],
  NBA_SOUTHEAST: ['ATL', 'CHA', 'MIA', 'ORL', 'WAS'],
  NBA_NORTHWEST: ['DEN', 'MIN', 'OKC', 'POR', 'UTAH', 'UTA'],
  NBA_PACIFIC: ['GSW', 'LAC', 'LAL', 'PHX', 'SAC'],
  NBA_SOUTHWEST: ['DAL', 'HOU', 'MEM', 'NO', 'NOP', 'SA'],
  
  // NFL
  NFL_AFC_EAST: ['BUF', 'MIA', 'NE', 'NYJ'],
  NFL_AFC_NORTH: ['BAL', 'CIN', 'CLE', 'PIT'],
  NFL_AFC_SOUTH: ['HOU', 'IND', 'JAX', 'TEN'],
  NFL_AFC_WEST: ['DEN', 'KC', 'LV', 'LAC'],
  NFL_NFC_EAST: ['DAL', 'NYG', 'PHI', 'WAS'],
  NFL_NFC_NORTH: ['CHI', 'DET', 'GB', 'MIN'],
  NFL_NFC_SOUTH: ['ATL', 'CAR', 'NO', 'TB'],
  NFL_NFC_WEST: ['ARI', 'LAR', 'SEA', 'SF'],
  
  // MLB
  MLB_AL_EAST: ['BAL', 'BOS', 'NYY', 'TB', 'TOR'],
  MLB_AL_CENTRAL: ['CLE', 'CHW', 'DET', 'KC', 'MIN'],
  MLB_AL_WEST: ['HOU', 'LAA', 'OAK', 'SEA', 'TEX'],
  MLB_NL_EAST: ['ATL', 'MIA', 'NYM', 'PHI', 'WAS'],
  MLB_NL_CENTRAL: ['CHC', 'CIN', 'MIL', 'PIT', 'STL'],
  MLB_NL_WEST: ['ARI', 'COL', 'LAD', 'SD', 'SF'],
};

// Get divisions for a sport
const getDivisionsForSport = (sport) => {
  const prefix = sport.toUpperCase() + '_';
  return Object.entries(DIVISIONS)
    .filter(([key]) => key.startsWith(prefix) || (sport === 'nba' && !key.includes('_')))
    .reduce((acc, [key, teams]) => {
      acc[key] = teams;
      return acc;
    }, {});
};

// ============================================
// DATA VALIDATION & SANITY CHECKS
// ============================================

const validateGameData = (homeTeam, awayTeam, gameDate) => {
  const issues = [];
  const criticalMissing = []; // HARD FIX #4: Track critical missing fields separately
  const currentDate = new Date();
  const gameDateTime = new Date(gameDate);
  
  // HARD FIX #4: Check for critical null fields FIRST
  // These are fields that MUST exist for correct operation
  if (!homeTeam) {
    criticalMissing.push('HOME_TEAM_NULL');
  } else {
    if (!homeTeam.abbreviation) criticalMissing.push('HOME_ABBREVIATION_NULL');
    if (!homeTeam.name) issues.push('HOME_NAME_MISSING'); // Non-critical, has fallback
  }
  
  if (!awayTeam) {
    criticalMissing.push('AWAY_TEAM_NULL');
  } else {
    if (!awayTeam.abbreviation) criticalMissing.push('AWAY_ABBREVIATION_NULL');
    if (!awayTeam.name) issues.push('AWAY_NAME_MISSING'); // Non-critical, has fallback
  }
  
  // If critical fields are missing, return immediately with fallback mode
  if (criticalMissing.length > 0) {
    const telemetry = {
      type: 'CRITICAL_DATA_MISSING',
      criticalMissing,
      homeTeam: homeTeam?.abbreviation || homeTeam?.name || 'NULL',
      awayTeam: awayTeam?.abbreviation || awayTeam?.name || 'NULL'
    };
    console.error('[Gamenight] Critical data missing:', telemetry);
    logError(new Error('Critical game data missing'), telemetry);
    
    return {
      valid: false,
      fallbackMode: true,
      dataQuality: 'CRITICAL_MISSING',
      issues: [...criticalMissing, ...issues],
      criticalMissing
    };
  }
  
  // Helper to parse record
  const parseRecord = (record) => {
    if (!record || record === '0-0') return { wins: 0, losses: 0, games: 0 };
    const parts = record.split('-').map(Number);
    return { wins: parts[0] || 0, losses: parts[1] || 0, games: (parts[0] || 0) + (parts[1] || 0) };
  };
  
  const homeStats = parseRecord(homeTeam.record);
  const awayStats = parseRecord(awayTeam.record);
  
  // A. Season Progress Validation
  const month = currentDate.getMonth(); // 0-indexed
  const day = currentDate.getDate();
  
  let minGamesRequired = 10; // Default early season
  if (month > 1 || (month === 1 && day >= 15)) minGamesRequired = 50; // After Feb 15
  else if (month > 0 || (month === 0 && day >= 15)) minGamesRequired = 30; // After Jan 15
  else if (month === 11 && day >= 15) minGamesRequired = 20; // After Dec 15
  
  if (homeStats.games < minGamesRequired && homeStats.games > 0) {
    issues.push(`HOME_INSUFFICIENT_GAMES: ${homeStats.games} < ${minGamesRequired}`);
  }
  if (awayStats.games < minGamesRequired && awayStats.games > 0) {
    issues.push(`AWAY_INSUFFICIENT_GAMES: ${awayStats.games} < ${minGamesRequired}`);
  }
  
  // B. Record Plausibility Check
  const homeWinPct = homeStats.games > 0 ? homeStats.wins / homeStats.games : 0.5;
  const awayWinPct = awayStats.games > 0 ? awayStats.wins / awayStats.games : 0.5;
  
  if (homeStats.games > 15 && (homeWinPct > 0.85 || homeWinPct < 0.15)) {
    issues.push(`HOME_SUSPICIOUS_RECORD: ${homeWinPct.toFixed(3)}`);
  }
  if (awayStats.games > 15 && (awayWinPct > 0.85 || awayWinPct < 0.15)) {
    issues.push(`AWAY_SUSPICIOUS_RECORD: ${awayWinPct.toFixed(3)}`);
  }
  
  // C. Missing Critical Fields (records)
  if (!homeTeam.record || homeTeam.record === '0-0') {
    issues.push('HOME_MISSING_RECORD');
  }
  if (!awayTeam.record || awayTeam.record === '0-0') {
    issues.push('AWAY_MISSING_RECORD');
  }
  
  // HARD FIX #4: Log telemetry when data validation issues are detected
  if (issues.length > 0) {
    const telemetry = {
      type: 'DATA_VALIDATION_ISSUE',
      issues,
      homeTeam: homeTeam.abbreviation || homeTeam.name,
      awayTeam: awayTeam.abbreviation || awayTeam.name,
      homeRecord: homeTeam.record,
      awayRecord: awayTeam.record
    };
    console.warn('[Gamenight] Data validation issues:', telemetry);
    logError(new Error('Data validation issues detected'), telemetry);
  }
  
  return {
    valid: issues.length === 0,
    fallbackMode: issues.length > 0,
    dataQuality: issues.length === 0 ? 'HIGH' : 'DEGRADED',
    issues,
    criticalMissing: []
  };
};

// ============================================
// SCORING COMPONENTS
// ============================================

// 1. STAKES SCORE (0-30 pts) - How much does this game matter?
const calculateStakesScore = (homeTeam, awayTeam, validation, sport = 'nba') => {
  if (validation.fallbackMode) return { score: 10, reason: 'Data quality limited' };
  
  const parseRecord = (record) => {
    if (!record) return { wins: 0, losses: 0, pct: 0.5 };
    const [w, l] = record.split('-').map(Number);
    return { wins: w || 0, losses: l || 0, pct: (w / (w + l)) || 0.5 };
  };
  
  const home = parseRecord(homeTeam.record);
  const away = parseRecord(awayTeam.record);
  
  let score = 5; // Base score
  let reason = 'Regular season matchup';
  
  // Both teams above .500 (playoff contenders)
  if (home.pct > 0.5 && away.pct > 0.5) {
    score = 18;
    reason = 'Both teams in playoff contention';
  }
  // Both teams above .550 (strong contenders)
  else if (home.pct > 0.55 && away.pct > 0.55) {
    score = 22;
    reason = 'Elite matchup between top teams';
  }
  // One team good, one fighting
  else if ((home.pct > 0.5 && away.pct > 0.4) || (away.pct > 0.5 && home.pct > 0.4)) {
    score = 15;
    reason = 'Competitive matchup';
  }
  // One good team vs struggling team
  else if (home.pct > 0.55 || away.pct > 0.55) {
    score = 10;
    reason = 'Features a top team';
  }
  // Both struggling
  else if (home.pct < 0.4 && away.pct < 0.4) {
    score = 5;
    reason = 'Rebuilding teams';
  }
  
  // Check for same division (adds stakes) - use sport-specific divisions
  const sportDivisions = getDivisionsForSport(sport);
  const homeDivision = Object.entries(sportDivisions).find(([_, teams]) => 
    teams.includes(homeTeam.abbreviation))?.[0];
  const awayDivision = Object.entries(sportDivisions).find(([_, teams]) => 
    teams.includes(awayTeam.abbreviation))?.[0];
  
  if (homeDivision && homeDivision === awayDivision) {
    score = Math.min(30, score + 5);
    reason += ' • Division matchup';
  }
  
  return { score: Math.min(30, score), reason };
};

// ============================================
// SPORT-SPECIFIC KEY PLAYER DATA
// ============================================

// ============================================
// 2. STAR/KEY PLAYER SCORE - SPORT SPECIFIC
// ============================================
// CRITICAL: Must NEVER produce same-team "vs" matchups in ANY sport
// CRITICAL: Must ONLY use sport-scoped player data (no cross-contamination)

const calculateStarPowerScore = (homeTeam, awayTeam, sport = 'nba', sportData = {}) => {
  // HARD GUARD: Validate sport parameter
  if (!sport || !['nba', 'nfl', 'mlb'].includes(sport)) {
    console.warn('Invalid sport for star power calculation:', sport);
    return { score: 5, stars: [], homeStars: [], awayStars: [], matchupType: 'none', matchupText: '', matchupLabel: '', reason: '' };
  }
  
  // Route to sport-specific calculator
  if (sport === 'nfl') {
    return calculateNFLKeyPlayers(homeTeam, awayTeam);
  } else if (sport === 'mlb') {
    // Pass pitcher data for MLB
    return calculateMLBKeyPlayers(homeTeam, awayTeam, sportData.homePitcher, sportData.awayPitcher);
  }
  return calculateNBAStarPower(homeTeam, awayTeam);
};

// ============================================
// NBA Star Power Calculator
// ============================================
const calculateNBAStarPower = (homeTeam, awayTeam) => {
  const homeAbbr = homeTeam?.abbreviation || '';
  const awayAbbr = awayTeam?.abbreviation || '';
  
  // SPORT-SCOPED: Only get NBA players
  const rawHomeStars = getPlayersForTeam(homeAbbr, 'nba');
  const rawAwayStars = getPlayersForTeam(awayAbbr, 'nba');
  
  // HARD FIX #1: Filter out injured/unavailable players
  const { availablePlayers: homeStars, hasUnverifiedPlayers: homeUnverified } = 
    filterAvailablePlayers(rawHomeStars, homeAbbr, 'nba');
  const { availablePlayers: awayStars, hasUnverifiedPlayers: awayUnverified } = 
    filterAvailablePlayers(rawAwayStars, awayAbbr, 'nba');
  
  const hasUnverifiedPlayers = homeUnverified || awayUnverified;
  
  const { mvp, allStar } = getStarTiers('nba');
  
  // Categorize by tier AND team - keep lists strictly separated
  // Only use AVAILABLE players
  const homeMVPs = homeStars.filter(s => mvp.includes(s));
  const awayMVPs = awayStars.filter(s => mvp.includes(s));
  const homeAllStars = homeStars.filter(s => allStar.includes(s));
  const awayAllStars = awayStars.filter(s => allStar.includes(s));
  
  const totalMVPs = homeMVPs.length + awayMVPs.length;
  const totalAllStars = homeAllStars.length + awayAllStars.length;
  
  let score = 5;
  let homeStarList = [];
  let awayStarList = [];
  
  if (totalMVPs >= 2) {
    score = 20;
    homeStarList = [...homeMVPs, ...homeAllStars];
    awayStarList = [...awayMVPs, ...awayAllStars];
  } else if (totalMVPs === 1 && totalAllStars >= 1) {
    score = 17;
    homeStarList = [...homeMVPs, ...homeAllStars];
    awayStarList = [...awayMVPs, ...awayAllStars];
  } else if (totalAllStars >= 2) {
    score = 15;
    homeStarList = homeAllStars;
    awayStarList = awayAllStars;
  } else if (totalMVPs === 1) {
    score = 13;
    homeStarList = homeMVPs;
    awayStarList = awayMVPs;
  } else if (totalAllStars >= 1) {
    score = 10;
    homeStarList = homeAllStars;
    awayStarList = awayAllStars;
  }
  
  // HARD FIX #1: If players are unverified, reduce confidence
  // This triggers softer language and prevents CLEAR tier
  const injuryStatusVerified = !hasUnverifiedPlayers;
  
  return buildMatchupResult(homeTeam, awayTeam, homeStarList, awayStarList, score, 'nba', injuryStatusVerified);
};

// ============================================
// NFL Key Players Calculator
// ============================================
// RULE: Always show either:
//   1. Two players from DIFFERENT teams ("Player A vs Player B")
//   2. ONE player only
// NEVER show two players from the same team
// CRITICAL: Only uses NFL_PLAYERS data (no cross-sport contamination)
// HARD FIX #1: Filters out injured players before selection
const calculateNFLKeyPlayers = (homeTeam, awayTeam) => {
  // P1 FIX: Null-safe abbreviation access
  const homeAbbr = homeTeam?.abbreviation || '';
  const awayAbbr = awayTeam?.abbreviation || '';
  
  // SPORT-SCOPED: Only get NFL players
  const rawHomeQB = getNFLTeamQB(homeAbbr);
  const rawAwayQB = getNFLTeamQB(awayAbbr);
  
  // Get NFL-only team stars
  const rawHomeStars = getPlayersForTeam(homeAbbr, 'nfl');
  const rawAwayStars = getPlayersForTeam(awayAbbr, 'nfl');
  
  // HARD FIX #1: Filter injured players
  let hasUnverifiedPlayers = false;
  
  // Check QBs for availability
  let homeQB = null;
  let awayQB = null;
  if (rawHomeQB) {
    const { available, verified } = isPlayerAvailableForMatchup(rawHomeQB, homeAbbr, 'nfl');
    if (available) homeQB = rawHomeQB;
    if (!verified) hasUnverifiedPlayers = true;
  }
  if (rawAwayQB) {
    const { available, verified } = isPlayerAvailableForMatchup(rawAwayQB, awayAbbr, 'nfl');
    if (available) awayQB = rawAwayQB;
    if (!verified) hasUnverifiedPlayers = true;
  }
  
  // Filter team stars for availability
  const { availablePlayers: homeStars, hasUnverifiedPlayers: homeUnverified } = 
    filterAvailablePlayers(rawHomeStars, homeAbbr, 'nfl');
  const { availablePlayers: awayStars, hasUnverifiedPlayers: awayUnverified } = 
    filterAvailablePlayers(rawAwayStars, awayAbbr, 'nfl');
  
  if (homeUnverified || awayUnverified) hasUnverifiedPlayers = true;
  
  // Categorize by type (using NFL-specific defensive stars)
  const homeDefense = homeStars.filter(p => 
    ['Micah Parsons', 'T.J. Watt', 'Nick Bosa', 'Myles Garrett'].includes(p)
  );
  const awayDefense = awayStars.filter(p => 
    ['Micah Parsons', 'T.J. Watt', 'Nick Bosa', 'Myles Garrett'].includes(p)
  );
  
  let score = 5;
  let matchupType = 'none';
  let matchupText = '';
  let matchupLabel = '';
  let displayedStars = [];
  const injuryStatusVerified = !hasUnverifiedPlayers;
  
  // CASE 1: Both teams have AVAILABLE star QBs
  if (homeQB && awayQB && homeAbbr && awayAbbr && homeAbbr !== awayAbbr) {
    score = 20;
    matchupType = 'vs';
    matchupText = `${awayQB} vs ${homeQB}`;
    matchupLabel = injuryStatusVerified ? 'QB Matchup' : 'Expected QB Matchup';
    displayedStars = [awayQB, homeQB];
  }
  // CASE 2: One team has QB, other has defensive star (TWO players, DIFFERENT teams)
  else if ((homeQB && awayDefense.length > 0) || (awayQB && homeDefense.length > 0)) {
    score = 15;
    if (homeQB && awayDefense.length > 0 && homeAbbr && awayAbbr && homeAbbr !== awayAbbr) {
      matchupType = 'vs';
      matchupText = `${awayDefense[0]} vs ${homeQB}`;
      matchupLabel = injuryStatusVerified ? 'Key Matchup' : 'Key Players';
      displayedStars = [awayDefense[0], homeQB];
    } else if (awayQB && homeDefense.length > 0 && homeAbbr && awayAbbr && homeAbbr !== awayAbbr) {
      matchupType = 'vs';
      matchupText = `${awayQB} vs ${homeDefense[0]}`;
      matchupLabel = injuryStatusVerified ? 'Key Matchup' : 'Key Players';
      displayedStars = [awayQB, homeDefense[0]];
    } else {
      // Fallback - show single player only
      matchupType = 'featured';
      const singleStar = homeQB || awayQB || homeDefense[0] || awayDefense[0];
      matchupText = singleStar;
      matchupLabel = injuryStatusVerified ? 'Featured Player' : 'Player to Watch';
      displayedStars = singleStar ? [singleStar] : [];
    }
  }
  // CASE 3: Both teams have non-QB stars (TWO players, DIFFERENT teams)
  else if (homeStars.length > 0 && awayStars.length > 0 && homeAbbr && awayAbbr && homeAbbr !== awayAbbr) {
    score = 12;
    matchupType = 'vs';
    matchupText = `${awayStars[0]} vs ${homeStars[0]}`;
    matchupLabel = injuryStatusVerified ? 'Key Matchup' : 'Key Players';
    displayedStars = [awayStars[0], homeStars[0]];
  }
  // CASE 4: Only one team has star QB (ONE player only)
  else if (homeQB || awayQB) {
    score = 13;
    matchupType = 'featured';
    const qbName = awayQB || homeQB;
    matchupText = qbName;
    matchupLabel = injuryStatusVerified ? 'Featured QB' : 'QB to Watch';
    displayedStars = [qbName];
  }
  // CASE 5: Only one team has notable players (ONE player only)
  else if (homeStars.length > 0 || awayStars.length > 0) {
    score = 8;
    matchupType = 'featured';
    const singleStar = awayStars[0] || homeStars[0];
    matchupText = singleStar;
    matchupLabel = injuryStatusVerified ? 'Featured Player' : 'Player to Watch';
    displayedStars = singleStar ? [singleStar] : [];
  }
  // CASE 6: No AVAILABLE notable players
  else {
    score = 5;
    matchupType = 'none';
    matchupText = '';
    matchupLabel = '';
    displayedStars = [];
  }
  
  return {
    score,
    stars: displayedStars,
    homeStars: homeStars.slice(0, 2),
    awayStars: awayStars.slice(0, 2),
    matchupType,
    matchupText,
    matchupLabel,
    // HARD FIX #1: Computed from actual injury data availability
    injuryStatusVerified,
    reason: matchupText || 'No standout players'
  };
};

// ============================================
// MLB Key Players Calculator
// ============================================
// PRIORITY ORDER (per requirements):
//   1. Starting Pitcher vs Starting Pitcher (if both confirmed)
//   2. Featured Starting Pitcher (if only one confirmed)
//   3. Top Batters vs Top Batters (FALLBACK ONLY - when no pitcher data)
//   4. MVP status is tie-breaker for scoring, NEVER primary selector
//
// RULE: Always show either:
//   - Two players from DIFFERENT teams ("Player A vs Player B")
//   - ONE player only
//   - NEVER show two players from the same team
// CRITICAL: Only uses MLB_PLAYERS data (no cross-sport contamination)
// HARD FIX #1: Filters injured players before selection
const calculateMLBKeyPlayers = (homeTeam, awayTeam, homePitcher = null, awayPitcher = null) => {
  // P1 FIX: Null-safe abbreviation access
  const homeAbbr = homeTeam?.abbreviation || '';
  const awayAbbr = awayTeam?.abbreviation || '';
  
  let score = 5;
  let matchupType = 'none';
  let matchupText = '';
  let matchupLabel = '';
  let displayedStars = [];
  let hasUnverifiedPlayers = false;
  
  // ===== PRIORITY 1: Starting Pitcher vs Starting Pitcher =====
  // Pitchers come from ESPN "probables" - relatively reliable but could be scratched
  // HARD FIX #1: Check injury cache for pitchers
  let verifiedHomePitcher = null;
  let verifiedAwayPitcher = null;
  
  if (homePitcher) {
    const { available, verified } = isPlayerAvailableForMatchup(homePitcher, homeAbbr, 'mlb');
    if (available) verifiedHomePitcher = homePitcher;
    if (!verified) hasUnverifiedPlayers = true;
  }
  if (awayPitcher) {
    const { available, verified } = isPlayerAvailableForMatchup(awayPitcher, awayAbbr, 'mlb');
    if (available) verifiedAwayPitcher = awayPitcher;
    if (!verified) hasUnverifiedPlayers = true;
  }
  
  // Pitcher vs Pitcher (both available)
  if (verifiedHomePitcher && verifiedAwayPitcher && homeAbbr && awayAbbr && homeAbbr !== awayAbbr) {
    const isHomeAce = isMLBAcePitcher(verifiedHomePitcher);
    const isAwayAce = isMLBAcePitcher(verifiedAwayPitcher);
    
    if (isHomeAce && isAwayAce) {
      score = 20;
    } else if (isHomeAce || isAwayAce) {
      score = 17;
    } else {
      score = 14;
    }
    
    matchupType = 'vs';
    matchupText = `${verifiedAwayPitcher} vs ${verifiedHomePitcher}`;
    matchupLabel = hasUnverifiedPlayers ? 'Probable Pitchers' : 'Starting Pitchers';
    displayedStars = [verifiedAwayPitcher, verifiedHomePitcher];
    
    return {
      score,
      stars: displayedStars,
      homeStars: [verifiedHomePitcher],
      awayStars: [verifiedAwayPitcher],
      matchupType,
      matchupText,
      matchupLabel,
      injuryStatusVerified: !hasUnverifiedPlayers,
      reason: matchupText
    };
  }
  
  // ===== PRIORITY 2: Featured Starting Pitcher (one confirmed) =====
  if (verifiedHomePitcher || verifiedAwayPitcher) {
    const pitcher = verifiedAwayPitcher || verifiedHomePitcher;
    const isAce = isMLBAcePitcher(pitcher);
    
    score = isAce ? 15 : 12;
    matchupType = 'featured';
    matchupText = pitcher;
    matchupLabel = hasUnverifiedPlayers ? 'Probable Starter' : 'Starting Pitcher';
    displayedStars = [pitcher];
    
    return {
      score,
      stars: displayedStars,
      homeStars: verifiedHomePitcher ? [verifiedHomePitcher] : [],
      awayStars: verifiedAwayPitcher ? [verifiedAwayPitcher] : [],
      matchupType,
      matchupText,
      matchupLabel,
      injuryStatusVerified: !hasUnverifiedPlayers,
      reason: matchupText
    };
  }
  
  // ===== PRIORITY 3: FALLBACK - Top Batters (no pitcher data available) =====
  // SPORT-SCOPED: Only get MLB players
  const rawHomeStars = getPlayersForTeam(homeAbbr, 'mlb');
  const rawAwayStars = getPlayersForTeam(awayAbbr, 'mlb');
  
  // Filter to batters only, then filter for availability
  const homeStarBatters = rawHomeStars.filter(p => !isMLBAcePitcher(p) || p === 'Shohei Ohtani');
  const awayStarBatters = rawAwayStars.filter(p => !isMLBAcePitcher(p) || p === 'Shohei Ohtani');
  
  // HARD FIX #1: Filter injured batters
  const { availablePlayers: homeBatters, hasUnverifiedPlayers: homeUnverified } = 
    filterAvailablePlayers(homeStarBatters, homeAbbr, 'mlb');
  const { availablePlayers: awayBatters, hasUnverifiedPlayers: awayUnverified } = 
    filterAvailablePlayers(awayStarBatters, awayAbbr, 'mlb');
  
  if (homeUnverified || awayUnverified) hasUnverifiedPlayers = true;
  const injuryStatusVerified = !hasUnverifiedPlayers;
  
  // Get MVP tier for SCORING BONUS only
  const { mvp } = getStarTiers('mlb');
  
  // CASE 3a: Both teams have AVAILABLE star batters
  if (homeBatters.length > 0 && awayBatters.length > 0 && homeAbbr && awayAbbr && homeAbbr !== awayAbbr) {
    const homeBatter = homeBatters[0];
    const awayBatter = awayBatters[0];
    
    const homeIsMVP = mvp.includes(homeBatter);
    const awayIsMVP = mvp.includes(awayBatter);
    
    if (homeIsMVP && awayIsMVP) {
      score = 15;
    } else if (homeIsMVP || awayIsMVP) {
      score = 12;
    } else {
      score = 10;
    }
    
    matchupType = 'vs';
    matchupText = `${awayBatter} vs ${homeBatter}`;
    matchupLabel = injuryStatusVerified ? 'Star Batters' : 'Batters to Watch';
    displayedStars = [awayBatter, homeBatter];
  }
  // CASE 3b: One team has star batters
  else if (homeBatters.length > 0 || awayBatters.length > 0) {
    const singleBatter = awayBatters[0] || homeBatters[0];
    const isMVP = mvp.includes(singleBatter);
    
    score = isMVP ? 10 : 8;
    matchupType = 'featured';
    matchupText = singleBatter;
    matchupLabel = injuryStatusVerified ? 'Featured Batter' : 'Batter to Watch';
    displayedStars = [singleBatter];
  }
  // CASE 3c: No AVAILABLE notable batters
  else {
    score = 5;
    matchupType = 'none';
    matchupText = '';
    matchupLabel = '';
    displayedStars = [];
  }
  
  return {
    score,
    stars: displayedStars,
    homeStars: homeBatters.slice(0, 2),
    awayStars: awayBatters.slice(0, 2),
    matchupType,
    matchupText,
    matchupLabel,
    injuryStatusVerified,
    reason: matchupText || 'No pitcher data available'
  };
};

// ============================================
// Shared Matchup Result Builder
// ============================================
// RULE: Always show either:
//   1. Two players from DIFFERENT teams ("Player A vs Player B")
//   2. ONE player only ("Features Player A")
// NEVER show two players from the same team
// HARD FIX #1: injuryStatusVerified determines label confidence
const buildMatchupResult = (homeTeam, awayTeam, homeStarList, awayStarList, score, sport, injuryStatusVerified = false) => {
  const bestHomeStar = homeStarList[0] || null;
  const bestAwayStar = awayStarList[0] || null;
  // P1 FIX: Null-safe abbreviation access
  const homeTeamAbbr = homeTeam?.abbreviation || '';
  const awayTeamAbbr = awayTeam?.abbreviation || '';
  
  let matchupType = 'none';
  let matchupText = '';
  
  // HARD FIX #1: Label reflects actual verification status
  // If verified: confident labels. If not: hedged labels.
  let matchupLabel;
  if (injuryStatusVerified) {
    matchupLabel = sport === 'nba' ? 'Star Matchup' : 'Key Players';
  } else {
    matchupLabel = sport === 'nba' ? 'Expected Matchup' : 'Key Players';
  }
  
  let allStars = [];
  
  // CRITICAL VALIDATION: Only "vs" if BOTH teams have stars AND teams are different
  // P1 FIX: Also require valid abbreviations to prevent undefined comparison
  if (bestHomeStar && bestAwayStar && homeTeamAbbr && awayTeamAbbr && homeTeamAbbr !== awayTeamAbbr) {
    matchupType = 'vs';
    matchupText = `${bestAwayStar} vs ${bestHomeStar}`;
    allStars = [bestAwayStar, bestHomeStar];
  } else if (bestHomeStar || bestAwayStar) {
    // Only one team has stars - show ONLY ONE player, never multiple from same team
    matchupType = 'featured';
    const singleStar = bestAwayStar || bestHomeStar;
    matchupLabel = injuryStatusVerified ? 'Featured Player' : 'Player to Watch';
    matchupText = `${singleStar}`;
    allStars = [singleStar];
  } else {
    matchupType = 'none';
    matchupText = '';
    matchupLabel = '';
    allStars = [];
  }
  
  return {
    score,
    stars: allStars,
    homeStars: homeStarList.slice(0, 2),
    awayStars: awayStarList.slice(0, 2),
    matchupType,
    matchupText,
    matchupLabel,
    // HARD FIX #1: This is now computed from actual injury data availability
    injuryStatusVerified,
    reason: matchupText || 'No major stars'
  };
};

// 3. COMPETITIVENESS SCORE (0-20 pts) - Will it be close?
const calculateCompetitivenessScore = (homeTeam, awayTeam, validation) => {
  if (validation.fallbackMode) return { score: 10, reason: 'Unable to assess', diff: null };
  
  const parseWinPct = (record) => {
    if (!record) return 0.5;
    const [w, l] = record.split('-').map(Number);
    return (w / (w + l)) || 0.5;
  };
  
  const homePct = parseWinPct(homeTeam.record);
  const awayPct = parseWinPct(awayTeam.record);
  const diff = Math.abs(homePct - awayPct);
  
  let score = 4;
  let reason = 'Likely mismatch';
  
  if (diff <= 0.05) {
    score = 20;
    reason = 'Evenly matched teams';
  } else if (diff <= 0.10) {
    score = 16;
    reason = 'Close matchup';
  } else if (diff <= 0.15) {
    score = 12;
    reason = 'Slight edge to one team';
  } else if (diff <= 0.25) {
    score = 8;
    reason = 'Clear favorite';
  }
  
  return { score, reason, diff: (diff * 100).toFixed(1) };
};

// 4. NARRATIVE SCORE (0-20 pts) - Is there a story?
const calculateNarrativeScore = (homeTeam, awayTeam, headline) => {
  let score = 5;
  let reasons = [];
  
  // P1 FIX: Null-safe rivalry check
  const homeAbbr = homeTeam?.abbreviation || '';
  const awayAbbr = awayTeam?.abbreviation || '';
  
  // Check for rivalry
  const rivalryKey1 = `${homeAbbr}-${awayAbbr}`;
  const rivalryKey2 = `${awayAbbr}-${homeAbbr}`;
  const rivalryIntensity = (homeAbbr && awayAbbr) ? (RIVALRIES[rivalryKey1] || RIVALRIES[rivalryKey2] || 0) : 0;
  
  if (rivalryIntensity === 3) {
    score = 20;
    reasons.push('Historic rivalry');
  } else if (rivalryIntensity === 2) {
    score = 15;
    reasons.push('Notable rivalry');
  } else if (rivalryIntensity === 1) {
    score = 10;
    reasons.push('Regional rivalry');
  }
  
  // ESPN headline bonus
  if (headline && headline.length > 10) {
    score = Math.min(20, score + 3);
    reasons.push('Featured matchup');
  }
  
  // Same state/city matchups - null-safe
  const homeCity = homeTeam?.city || '';
  const awayCity = awayTeam?.city || '';
  const sameCity = (homeCity && awayCity && homeCity === awayCity);
  if (sameCity && rivalryIntensity === 0) {
    score = Math.min(20, score + 8);
    reasons.push('City showdown');
  }
  
  return { 
    score, 
    reason: reasons.length > 0 ? reasons.join(' • ') : 'No major storyline'
  };
};

// 5. ACCESSIBILITY SCORE (0-10 pts) - Can people watch it?
const calculateAccessibilityScore = (network, startTime) => {
  let score = 3; // Regional only default
  let reason = 'Regional broadcast';
  
  const nationalNetworks = ['ESPN', 'TNT', 'ABC', 'NBC', 'FOX'];
  const secondaryNetworks = ['NBA TV', 'ESPN2', 'FS1', 'Peacock', 'NBATV'];
  
  if (network) {
    if (nationalNetworks.some(n => network.toUpperCase().includes(n))) {
      score = 10;
      reason = `National TV (${network})`;
    } else if (secondaryNetworks.some(n => network.toUpperCase().includes(n))) {
      score = 7;
      reason = `Streaming/Cable (${network})`;
    } else {
      score = 5;
      reason = `Available on ${network}`;
    }
  }
  
  // Primetime bonus (7-10 PM ET start)
  if (startTime) {
    const hour = new Date(startTime).getHours();
    if (hour >= 19 && hour <= 22) {
      score = Math.min(10, score + 1);
    }
  }
  
  return { score, reason };
};

// ============================================
// MAIN WATCHABILITY CALCULATOR
// ============================================

const calculateWatchability = (homeTeam, awayTeam, network, startTime, headline, sport = 'nba', sportData = {}) => {
  // Validate data
  const validation = validateGameData(homeTeam, awayTeam, startTime);
  
  // Calculate component scores (pass sport and sport-specific data to relevant functions)
  const stakes = calculateStakesScore(homeTeam, awayTeam, validation, sport);
  const starPower = calculateStarPowerScore(homeTeam, awayTeam, sport, sportData);
  const competitiveness = calculateCompetitivenessScore(homeTeam, awayTeam, validation);
  const narrative = calculateNarrativeScore(homeTeam, awayTeam, headline);
  const accessibility = calculateAccessibilityScore(network, startTime);
  
  // Apply weights based on fallback mode
  let totalScore;
  
  // HARD FIX #1: If injury status is unverified and we have a "vs" matchup,
  // we're asserting players will play without confirmation - reduce confidence
  const hasUnverifiedVsMatchup = (starPower.matchupType === 'vs') && !starPower.injuryStatusVerified;
  
  if (validation.fallbackMode) {
    // Fallback weights: Stakes 10, StarPower 25, Comp 10, Narrative 25, Access 10 = 80 max
    totalScore = Math.round(
      (stakes.score / 30 * 10) +
      (starPower.score / 20 * 25) +
      (competitiveness.score / 20 * 10) +
      (narrative.score / 20 * 25) +
      (accessibility.score / 10 * 10)
    );
    // Cap at 70 in fallback mode
    totalScore = Math.min(70, totalScore);
  } else if (hasUnverifiedVsMatchup) {
    // HARD FIX #1: Normal calculation but reduce star power contribution
    // We're showing players without injury verification
    const reducedStarPower = Math.round(starPower.score * 0.7); // 30% penalty
    totalScore = stakes.score + reducedStarPower + competitiveness.score + narrative.score + accessibility.score;
    // Cap at 85 when showing unverified matchups
    totalScore = Math.min(85, totalScore);
  } else {
    // Normal weights
    totalScore = stakes.score + starPower.score + competitiveness.score + narrative.score + accessibility.score;
  }
  
  // Build "Why Watch" text
  // RULE: Player names shown in matchup card should NOT be repeated in whyWatch
  // - 'vs' matchup: Use abstract descriptions (names shown in card)
  // - 'featured' matchup: Can mention player (only appears once)
  // - 'none': Use team-based descriptions
  
  const hasStarMatchup = starPower.matchupType === 'vs';
  const hasFeaturedPlayer = starPower.matchupType === 'featured';
  
  // Collect non-player reasons (stakes, competitiveness, narrative, accessibility)
  const contextReasons = [];
  if (stakes.score >= 15) contextReasons.push(stakes.reason);
  if (competitiveness.score >= 16) contextReasons.push(competitiveness.reason);
  if (narrative.score >= 10) contextReasons.push(narrative.reason);
  if (accessibility.score >= 7) contextReasons.push(accessibility.reason);
  
  // Abstract descriptions for vs matchups (no player names)
  // P0 FIX: In fallback mode, use softer language (no superlatives)
  const getAbstractMatchupPhrase = (label, score, isFallbackMode) => {
    // In fallback mode, use conservative language (data quality is degraded)
    if (isFallbackMode) {
      if (label === 'Expected QB Matchup' || label === 'QB Matchup') {
        return 'Two quarterbacks face off tonight';
      }
      if (label === 'Starting Pitchers') {
        return 'Two starters take the mound tonight';
      }
      if (label === 'Star Batters') {
        return 'Notable bats in tonight\'s lineup';
      }
      if (label === 'Expected Matchup' || label === 'Star Matchup') {
        return 'Notable players from both teams tonight';
      }
      if (label === 'Key Players' || label === 'Key Matchup') {
        return 'Players to watch in tonight\'s game';
      }
      return 'A matchup worth watching tonight';
    }
    
    // Normal mode - confident language is appropriate
    // Sport-specific abstract phrases based on matchup label
    if (label === 'Expected QB Matchup' || label === 'QB Matchup') {
      if (score >= 18) return 'Elite quarterback showdown tonight';
      return 'Two quality signal-callers face off';
    }
    if (label === 'Starting Pitchers') {
      if (score >= 18) return 'Premium pitching duel on the mound';
      return 'Quality arms take the mound tonight';
    }
    if (label === 'Star Batters') {
      if (score >= 14) return 'Offensive firepower on both sides';
      return 'Star-studded lineups clash tonight';
    }
    if (label === 'Expected Matchup' || label === 'Star Matchup') {
      if (score >= 18) return 'Superstar showdown headlines tonight';
      return 'Top talent on display from both teams';
    }
    if (label === 'Key Players' || label === 'Key Matchup') {
      if (score >= 15) return 'Marquee matchup between key playmakers';
      return 'Impact players headline this contest';
    }
    // Default
    return 'Compelling matchup between two quality squads';
  };
  
  // Build whyWatch based on matchup type
  let whyWatch;
  const isFallbackMode = validation.fallbackMode;
  
  if (hasStarMatchup) {
    // VS MATCHUP: Names shown in card, use abstract description here
    const abstractPhrase = getAbstractMatchupPhrase(starPower.matchupLabel, starPower.score, isFallbackMode);
    
    if (contextReasons.length > 0) {
      // Add context (stakes, rivalry, etc.) - no player names
      whyWatch = `${abstractPhrase}. ${contextReasons[0]}.`;
    } else {
      whyWatch = `${abstractPhrase}.`;
    }
  } else if (hasFeaturedPlayer) {
    // FEATURED PLAYER: Name shown in card, use abstract description here too
    // (avoids duplication since card shows "Featured Player: [Name]")
    // P0 FIX: In fallback mode, use softer language for featured players too
    const getAbstractFeaturedPhrase = (label, isFallback) => {
      if (isFallback) {
        if (label === 'Featured QB') return 'A notable quarterback takes the field tonight';
        if (label === 'Starting Pitcher') return 'A starting pitcher to watch tonight';
        if (label === 'Featured Batter') return 'A hitter to watch in tonight\'s game';
        if (label === 'Featured Player') return 'A notable player in tonight\'s matchup';
        return 'A player worth watching tonight';
      }
      // Normal mode
      if (label === 'Featured QB') return 'One of the game\'s elite quarterbacks takes the field';
      if (label === 'Starting Pitcher') return 'A quality arm takes the mound tonight';
      if (label === 'Featured Batter') return 'One of baseball\'s most dangerous hitters in action';
      if (label === 'Featured Player') return 'A star player headlines tonight\'s matchup';
      return 'Notable talent on display tonight';
    };
    
    const abstractPhrase = getAbstractFeaturedPhrase(starPower.matchupLabel, isFallbackMode);
    
    if (contextReasons.length > 0) {
      whyWatch = `${abstractPhrase}. ${contextReasons[0]}.`;
    } else {
      whyWatch = `${abstractPhrase}.`;
    }
  } else {
    // NO MATCHUP: Team-based description
    // P1 FIX: Null-safe team name access
    const homeName = homeTeam?.name || 'Home Team';
    const awayName = awayTeam?.name || 'Away Team';
    if (contextReasons.length > 0) {
      whyWatch = `${awayName} at ${homeName}. ${contextReasons[0]}.`;
    } else if (validation.fallbackMode) {
      whyWatch = `${awayName} visits ${homeName} tonight.`;
    } else {
      whyWatch = `${awayName} takes on ${homeName}.`;
    }
  }
  
  // Clean up whyWatch - remove double periods, trim
  whyWatch = whyWatch.replace(/\.+/g, '.').replace(/\.\s*\./g, '.').trim();
  
  // Supporting reasons for tags (skip first context reason if used in whyWatch)
  const supportingReasons = (hasStarMatchup || hasFeaturedPlayer)
    ? contextReasons.slice(1, 3) // Skip first (used in whyWatch)
    : contextReasons.slice(0, 3);
  
  return {
    score: totalScore,
    whyWatch,
    validation: {
      ...validation,
      // HARD FIX #1: Include injury verification in validation
      injuryStatusVerified: starPower.injuryStatusVerified || false,
      hasUnverifiedVsMatchup
    },
    components: {
      stakes: stakes.score,
      starPower: starPower.score,
      competitiveness: competitiveness.score,
      narrative: narrative.score,
      accessibility: accessibility.score
    },
    details: {
      stakes,
      starPower,
      competitiveness,
      narrative,
      accessibility
    },
    supportingReasons: supportingReasons.slice(0, 3)
  };
};

// ============================================
// CONFIDENCE TIER CALCULATOR
// ============================================

const calculateConfidenceTier = (games, dataFreshness = null) => {
  if (!games || games.length === 0) {
    return {
      tier: 'WEAK',
      color: 'gray',
      header: 'No Games Tonight',
      subtext: 'Check back tomorrow for picks'
    };
  }
  
  // P0 FIX: Use centralized ranking function (no status influence, stable sort)
  const sortedGames = rankGamesByWatchability(games);
  const topScore = sortedGames[0]?.score || 0;
  const secondScore = sortedGames[1]?.score || 0;
  const scoreLead = topScore - secondScore;
  const topValidation = sortedGames[0]?.validation || { dataQuality: 'HIGH', fallbackMode: false };
  const topGameStatus = sortedGames[0]?.status || 'scheduled';
  
  // HARD FIX #1: Check if top game has unverified "vs" matchup
  const hasUnverifiedVsMatchup = topValidation.hasUnverifiedVsMatchup || false;
  
  // HARD FIX #2: Check data freshness
  let isDataStale = false;
  let dataAgeMinutes = 0;
  if (dataFreshness?.fetchTimestamp) {
    const freshnessCheck = validateDataFreshness(dataFreshness.fetchTimestamp, topGameStatus);
    isDataStale = !freshnessCheck.fresh;
    dataAgeMinutes = freshnessCheck.ageMinutes;
  }
  
  // CLEAR PICK: Score >= 80, HIGH quality, lead >= 10, no fallback, injuries verified, data fresh
  if (topScore >= 80 && 
      topValidation.dataQuality === 'HIGH' && 
      scoreLead >= 10 && 
      !topValidation.fallbackMode &&
      !hasUnverifiedVsMatchup &&
      !isDataStale) { // HARD FIX #2: Require fresh data for CLEAR
    return {
      tier: 'CLEAR',
      color: 'green',
      header: "Tonight's Clear Pick",
      subtext: 'The must-watch game tonight'
    };
  }
  
  // SOLID PICK: Score >= 65, or lead >= 8
  if (topScore >= 65 || scoreLead >= 8) {
    let subtext = 'The most compelling game tonight';
    if (isDataStale) {
      subtext = `Top option (data ${dataAgeMinutes}m old)`; // HARD FIX #2: Show staleness
    } else if (hasUnverifiedVsMatchup) {
      subtext = 'Top option tonight (check injury reports)';
    }
    return {
      tier: 'SOLID',
      color: 'yellow',
      header: "Tonight's Best Option",
      subtext
    };
  }
  
  // WEAK SLATE: Default
  return {
    tier: 'WEAK',
    color: 'gray',
    header: 'Best Available Tonight',
    subtext: isDataStale 
      ? 'Data may be outdated - refresh recommended'
      : 'No clear standout on a lighter slate'
  };
};

// ============================================
// ESPN GAME TRANSFORMER (Updated)
// ============================================

const transformESPNGame = (event, sport) => {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const homeTeam = competition.competitors?.find(c => c.homeAway === 'home');
  const awayTeam = competition.competitors?.find(c => c.homeAway === 'away');
  
  if (!homeTeam || !awayTeam) return null;

  const homeRecord = homeTeam.records?.[0]?.summary || '0-0';
  const awayRecord = awayTeam.records?.[0]?.summary || '0-0';
  const broadcasts = competition.broadcasts?.[0]?.names || [];
  const network = broadcasts[0] || null;
  const headline = event.competitions?.[0]?.headlines?.[0]?.shortLinkText;
  
  const homeName = homeTeam.team?.displayName;
  const awayName = awayTeam.team?.displayName;
  
  // Extract MLB probable pitchers (if available)
  // ESPN provides this in competition.probables or competitor.probables
  let homePitcher = null;
  let awayPitcher = null;
  
  if (sport === 'mlb') {
    // Try competition.probables first
    const probables = competition.probables || [];
    probables.forEach(probable => {
      const athleteName = probable.athlete?.displayName || probable.athlete?.fullName;
      if (probable.homeAway === 'home' && athleteName) {
        homePitcher = athleteName;
      } else if (probable.homeAway === 'away' && athleteName) {
        awayPitcher = athleteName;
      }
    });
    
    // Also try competitor.probables as backup
    if (!homePitcher && homeTeam.probables?.length > 0) {
      homePitcher = homeTeam.probables[0]?.athlete?.displayName || homeTeam.probables[0]?.athlete?.fullName;
    }
    if (!awayPitcher && awayTeam.probables?.length > 0) {
      awayPitcher = awayTeam.probables[0]?.athlete?.displayName || awayTeam.probables[0]?.athlete?.fullName;
    }
    
    // P1 FIX: Log telemetry when pitcher data is missing (common issue with MLB)
    if (!homePitcher || !awayPitcher) {
      console.log('[Gamenight] Missing MLB pitcher data:', {
        game: `${awayTeam.team?.abbreviation} @ ${homeTeam.team?.abbreviation}`,
        homePitcher: homePitcher || 'TBD',
        awayPitcher: awayPitcher || 'TBD',
        hasProbables: !!(competition.probables?.length > 0)
      });
    }
  }
  
  // Build team objects for watchability calculation
  const homeTeamData = {
    name: homeName,
    abbreviation: homeTeam.team?.abbreviation,
    record: homeRecord,
    city: homeTeam.team?.location
  };
  
  const awayTeamData = {
    name: awayName,
    abbreviation: awayTeam.team?.abbreviation,
    record: awayRecord,
    city: awayTeam.team?.location
  };
  
  // Calculate watchability with new algorithm
  // Pass pitcher data for MLB
  const watchability = calculateWatchability(
    homeTeamData,
    awayTeamData,
    network,
    event.date,
    headline,
    sport,
    { homePitcher, awayPitcher } // MLB-specific data
  );

  // Classify game date using proper UTC → ET conversion
  const dateClassification = classifyGameDate(event.date);

  return {
    id: event.id,
    gameDate: dateClassification.gameDateET || event.date?.split('T')[0], // Use ET date
    gameDateUTC: event.date?.split('T')[0], // Keep UTC date for reference
    startTime: event.date,
    startTimeUTC: event.date, // Explicit UTC reference
    dateClassification, // Full classification info
    network,
    status: competition.status?.type?.name || 'scheduled',
    homeScore: homeTeam.score ? parseInt(homeTeam.score) : null,
    awayScore: awayTeam.score ? parseInt(awayTeam.score) : null,
    homeTeam: {
      id: homeTeam.team?.abbreviation,
      name: homeName,
      abbreviation: homeTeam.team?.abbreviation,
      logo_url: homeTeam.team?.logo,
      record: homeRecord,
      city: homeTeam.team?.location,
    },
    awayTeam: {
      id: awayTeam.team?.abbreviation,
      name: awayName,
      abbreviation: awayTeam.team?.abbreviation,
      logo_url: awayTeam.team?.logo,
      record: awayRecord,
      city: awayTeam.team?.location,
    },
    score: watchability.score,
    whyWatch: watchability.whyWatch,
    validation: watchability.validation,
    components: watchability.components,
    supportingReasons: watchability.supportingReasons,
    // Sport-specific signal labels
    sport: sport,
    signals: {
      standingsRelevance: watchability.components.stakes >= 18 ? 'High' : watchability.components.stakes >= 12 ? 'Medium' : 'Low',
      // CRITICAL: Use validated matchup - NEVER show same-team "vs" matchups
      // Use sport-specific matchupLabel for proper display
      ...(watchability.details.starPower.matchupType === 'vs' ? {
        [watchability.details.starPower.matchupLabel || 'Star Matchup']: watchability.details.starPower.matchupText
      } : {}),
      // For single-team stars, use different label based on sport
      ...(watchability.details.starPower.matchupType === 'featured' ? {
        [watchability.details.starPower.matchupLabel || 'Players to Watch']: watchability.details.starPower.matchupText
      } : {}),
      rivalry: watchability.details.narrative.score >= 10 ? watchability.details.narrative.reason : null,
    },
    betting: null,
  };
};

// ============================================
// NFL Team Abbreviation to ESPN ID Mapping (for depth chart API)
// ============================================
const NFL_TEAM_IDS = {
  'ARI': 22, 'ATL': 1, 'BAL': 33, 'BUF': 2, 'CAR': 29, 'CHI': 3, 'CIN': 4, 'CLE': 5,
  'DAL': 6, 'DEN': 7, 'DET': 8, 'GB': 9, 'HOU': 34, 'IND': 11, 'JAX': 30, 'KC': 12,
  'LAC': 24, 'LAR': 14, 'LV': 13, 'MIA': 15, 'MIN': 16, 'NE': 17, 'NO': 18, 'NYG': 19,
  'NYJ': 20, 'PHI': 21, 'PIT': 23, 'SEA': 26, 'SF': 25, 'TB': 27, 'TEN': 10, 'WAS': 28
};

// ============================================
// Sort NFL Roster Using Depth Chart Data
// ============================================
const sortNFLRosterWithDepthChart = (roster, depthChartData) => {
  if (!depthChartData?.depthchart || depthChartData.depthchart.length === 0) {
    return null; // Fall back to default sorting
  }
  
  // Build a map of player ID -> { depthRank, positionOrder }
  // Lower depthRank = higher on depth chart (starter)
  // positionOrder determines which position groups appear first
  const positionGroupOrder = {
    'qb': 1, 'rb': 2, 'fb': 3,
    'wr1': 4, 'wr2': 5, 'wr3': 6, 'wr': 7,
    'te': 8,
    'lt': 9, 'lg': 10, 'c': 11, 'rg': 12, 'rt': 13,
    'lde': 14, 'nt': 15, 'rde': 16,
    'wlb': 17, 'lilb': 18, 'rilb': 19, 'slb': 20, 'mlb': 21,
    'lcb': 22, 'rcb': 23, 'nb': 24,
    'ss': 25, 'fs': 26,
    'pk': 27, 'p': 28, 'ls': 29, 'h': 30, 'kr': 31, 'pr': 32
  };
  
  const playerDepthMap = new Map();
  
  // Find the offensive formation (usually "3WR 1TE" which has QB, RB, WR, TE, OL)
  const offenseFormation = depthChartData.depthchart.find(dc => 
    dc.name?.includes('WR') || dc.name?.includes('TE') || dc.id === '21'
  );
  
  // Find the defensive formation (usually "Base 3-4 D")
  const defenseFormation = depthChartData.depthchart.find(dc => 
    dc.name?.includes('D') || dc.name?.includes('Defense') || dc.id === '15'
  );
  
  // Find special teams
  const specialTeams = depthChartData.depthchart.find(dc => 
    dc.name?.includes('Special') || dc.id === '18'
  );
  
  // Process each formation
  const formations = [offenseFormation, defenseFormation, specialTeams].filter(Boolean);
  
  formations.forEach(formation => {
    const positions = formation.positions || {};
    
    Object.entries(positions).forEach(([posKey, posData]) => {
      const athletes = posData.athletes || [];
      const baseOrder = positionGroupOrder[posKey.toLowerCase()] || 50;
      
      athletes.forEach((athlete, depthIndex) => {
        // Convert ID to string for consistent comparison
        const playerId = String(athlete.id);
        // Don't overwrite if already have a better (lower) rank from offense formation
        if (!playerDepthMap.has(playerId) || playerDepthMap.get(playerId).positionOrder > baseOrder) {
          playerDepthMap.set(playerId, {
            depthRank: depthIndex, // 0 = starter, 1 = backup, etc.
            positionOrder: baseOrder,
            positionKey: posKey.toUpperCase()
          });
        }
      });
    });
  });
  
  // Sort roster using depth chart data
  const sortedRoster = [...roster].sort((a, b) => {
    // Convert roster IDs to strings for comparison
    const aDepth = playerDepthMap.get(String(a.id));
    const bDepth = playerDepthMap.get(String(b.id));
    
    // Players on depth chart come before those not on it
    if (aDepth && !bDepth) return -1;
    if (!aDepth && bDepth) return 1;
    if (!aDepth && !bDepth) {
      // Neither on depth chart, sort by position then experience
      return (b.experience || 0) - (a.experience || 0);
    }
    
    // First sort by position group (QB before RB before WR, etc.)
    if (aDepth.positionOrder !== bDepth.positionOrder) {
      return aDepth.positionOrder - bDepth.positionOrder;
    }
    
    // Within same position, sort by depth (starter before backup)
    return aDepth.depthRank - bDepth.depthRank;
  });
  
  return sortedRoster;
};

// ============================================
// Roster Sorting by Sport
// ============================================
const sortRosterBySport = (roster, sport, depthChartData = null) => {
  if (!roster || roster.length === 0) return roster;
  
  if (sport === 'nba') {
    // NBA: Starters first (PG, SG, SF, PF, C), then bench by experience/relevance
    const positionOrder = { 'PG': 1, 'SG': 2, 'SF': 3, 'PF': 4, 'C': 5, 'G': 6, 'F': 7 };
    const starters = roster.filter(p => p.isStarter).sort((a, b) => 
      (positionOrder[a.position] || 99) - (positionOrder[b.position] || 99)
    );
    const bench = roster.filter(p => !p.isStarter).sort((a, b) => {
      // Sort by experience (more experienced = higher), then by position
      const expA = a.experience || 0;
      const expB = b.experience || 0;
      if (expB !== expA) return expB - expA;
      return (positionOrder[a.position] || 99) - (positionOrder[b.position] || 99);
    });
    return [...starters, ...bench];
  }
  
  if (sport === 'nfl') {
    // NFL: Use depth chart data if available for official ordering
    console.log('NFL sorting - depthChartData available:', !!depthChartData);
    if (depthChartData) {
      const depthSorted = sortNFLRosterWithDepthChart(roster, depthChartData);
      if (depthSorted) {
        console.log('Using depth chart sorting, first player:', depthSorted[0]?.name);
        return depthSorted;
      }
    }
    
    // Fallback: Sort by position group relevance (QB, RB, WR, TE, OL, DL, LB, DB, K, P)
    const positionOrder = {
      'QB': 1, 
      'RB': 2, 'FB': 3,
      'WR': 4, 'TE': 5,
      'LT': 6, 'LG': 7, 'C': 8, 'RG': 9, 'RT': 10, 'OL': 11, 'OT': 12, 'G': 13,
      'DE': 14, 'DT': 15, 'NT': 16, 'DL': 17,
      'OLB': 18, 'ILB': 19, 'MLB': 20, 'LB': 21,
      'CB': 22, 'S': 23, 'FS': 24, 'SS': 25, 'DB': 26,
      'K': 27, 'P': 28, 'LS': 29
    };
    return roster.sort((a, b) => {
      const posA = positionOrder[a.position] || 99;
      const posB = positionOrder[b.position] || 99;
      if (posA !== posB) return posA - posB;
      // Within same position, sort by experience
      return (b.experience || 0) - (a.experience || 0);
    });
  }
  
  if (sport === 'mlb') {
    // MLB: Starting pitcher first, then batting order positions, then rest
    const positionOrder = {
      'SP': 1,  // Starting Pitcher at top
      'C': 2, 'DH': 3, '1B': 4, '2B': 5, '3B': 6, 'SS': 7, 'LF': 8, 'CF': 9, 'RF': 10,
      'OF': 11, 'IF': 12, 'UT': 13,
      'RP': 14, 'CL': 15, 'P': 16  // Relief pitchers at bottom
    };
    return roster.sort((a, b) => {
      const posA = positionOrder[a.position] || 99;
      const posB = positionOrder[b.position] || 99;
      if (posA !== posB) return posA - posB;
      // Within same position, sort by experience
      return (b.experience || 0) - (a.experience || 0);
    });
  }
  
  return roster;
};

// ============================================
// API Functions
// ============================================
const api = {
  // Fetch live games via Supabase proxy (avoids CORS)
  // CLASSIFICATION-BASED: Games are classified, NOT filtered
  async getGamesFromESPN(sport = 'nba') {
    const fetchTimestamp = new Date().toISOString();
    const todayET = getTodayDateET();
    
    try {
      const res = await fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=scoreboard`);
      if (!res.ok) {
        console.error('ESPN proxy error:', res.status);
        logError(new Error(`ESPN proxy error: ${res.status}`), { sport, endpoint: 'scoreboard' });
        return { games: [], error: `API error: ${res.status}`, dataFreshness: { fetchTimestamp, todayET, status: 'ERROR' } };
      }
      const data = await res.json();
      if (data.error) {
        return { games: [], error: data.error, dataFreshness: { fetchTimestamp, todayET, status: 'ERROR' } };
      }
      
      // Transform all events - each game now has dateClassification
      const allGames = (data.events || [])
        .map(e => transformESPNGame(e, sport))
        .filter(Boolean);
      
      // CLASSIFICATION-BASED: DO NOT FILTER GAMES
      // Instead, classify and log each game's eligibility
      let todayCount = 0;
      let tomorrowCount = 0;
      let yesterdayCount = 0;
      let invalidCount = 0;
      
      allGames.forEach(game => {
        const c = game.dateClassification;
        if (c) {
          console.log(`[Gamenight] Game classified:`, {
            gameId: game.id,
            teams: `${game.awayTeam?.abbreviation} @ ${game.homeTeam?.abbreviation}`,
            utcDate: c.gameDateUTC,
            etDate: c.gameDateET,
            classification: c.classification,
            eligibleForPick: c.eligibleForTodayPick,
            reason: c.reason
          });
          
          if (c.classification === DATE_CLASSIFICATIONS.TODAY_ET || c.classification === DATE_CLASSIFICATIONS.LATE_NIGHT_ET) {
            todayCount++;
          } else if (c.classification === DATE_CLASSIFICATIONS.TOMORROW_ET) {
            tomorrowCount++;
          } else if (c.classification === DATE_CLASSIFICATIONS.YESTERDAY_ET) {
            yesterdayCount++;
          } else {
            invalidCount++;
          }
        }
      });
      
      // Separate games by eligibility for pick
      const gamesEligibleForPick = allGames.filter(g => g.dateClassification?.eligibleForTodayPick);
      const gamesNotEligible = allGames.filter(g => !g.dateClassification?.eligibleForTodayPick);
      
      // SLATE RENDERING GUARANTEE: If ESPN returns games, we show them
      // ALL games go in the slate, ranked by watchability
      // But only eligible games can be selected as Today's Pick
      const games = rankGamesByWatchability(allGames);
      
      // Build data freshness metadata
      const dataFreshness = {
        fetchTimestamp,
        todayET,
        status: 'OK',
        totalEventsReceived: data.events?.length || 0,
        gamesAfterTransform: allGames.length,
        // Classification counts (for debugging)
        classification: {
          todayET: todayCount,
          tomorrowET: tomorrowCount,
          yesterdayET: yesterdayCount,
          invalid: invalidCount,
          eligibleForPick: gamesEligibleForPick.length,
          notEligible: gamesNotEligible.length
        }
      };
      
      // Log classification summary
      console.log(`[Gamenight] Classification summary for ${sport}:`, dataFreshness.classification);
      
      return { 
        games, 
        gamesEligibleForPick, // Games that can be selected as Today's Pick
        dataFreshness 
      };
    } catch (err) {
      console.error('ESPN fetch failed:', err);
      logError(err, { sport, endpoint: 'scoreboard', context: 'getGamesFromESPN' });
      return { games: [], error: err.message || 'Network error', dataFreshness: { fetchTimestamp, todayET, status: 'ERROR' } };
    }
  },

  // Get tonight's pick (uses Pick State Machine)
  async getPicksToday(sport = 'nba') {
    const { games, gamesEligibleForPick, error, dataFreshness } = await this.getGamesFromESPN(sport);
    if (error) {
      return { pick: null, message: error, dataFreshness };
    }
    
    // SLATE RENDERING GUARANTEE: If ESPN returned games, we have games
    if (games.length === 0) {
      const message = dataFreshness?.status === 'OK' 
        ? `No ${sport.toUpperCase()} games today`
        : 'Unable to load games';
      return { pick: null, message, confidenceTier: calculateConfidenceTier([]), dataFreshness };
    }
    
    // Get watchable AND eligible games for pick selection
    const watchableEligible = (gamesEligibleForPick || games).filter(g => isGameWatchable(g.status));
    const confidenceTier = calculateConfidenceTier(watchableEligible, dataFreshness);
    
    // Load existing pick state and evaluate using ELIGIBLE games
    const existingPickState = loadPickState(sport);
    const evaluation = evaluatePick(existingPickState, gamesEligibleForPick || games, confidenceTier, sport);
    
    if (!evaluation.pick) {
      return { 
        pick: null, 
        message: evaluation.message || `All ${sport.toUpperCase()} games have finished`,
        confidenceTier: calculateConfidenceTier([]), 
        dataFreshness 
      };
    }
    
    return {
      pick: {
        id: evaluation.pick.id,
        date: evaluation.pick.gameDate,
        score: evaluation.pick.score,
        whyWatch: evaluation.pick.whyWatch,
        source: 'live',
        game: evaluation.pick,
        validation: evaluation.pick.validation,
        components: evaluation.pick.components,
        supportingReasons: evaluation.pick.supportingReasons,
      },
      pickState: evaluation.pickState,
      confidenceTier,
      dataFreshness
    };
  },

  async getGamesToday(sport = 'nba') {
    return this.getGamesFromESPN(sport);
  },

  // P0 FIX: Single fetch that returns both games and pick (with Pick State Machine)
  async getGamesAndPick(sport = 'nba') {
    const { games, gamesEligibleForPick, error, dataFreshness } = await this.getGamesFromESPN(sport);
    
    if (error) {
      return { 
        games: [], 
        pick: null, 
        pickState: null,
        message: error, 
        dataFreshness,
        confidenceTier: calculateConfidenceTier([])
      };
    }
    
    // SLATE RENDERING GUARANTEE: If ESPN returned games, show them
    // "No games today" ONLY when ESPN truly returns zero games
    if (games.length === 0) {
      const message = dataFreshness?.status === 'OK' 
        ? `No ${sport.toUpperCase()} games today`
        : 'Unable to load games';
      return { 
        games: [], 
        pick: null,
        pickState: null, 
        message, 
        dataFreshness,
        confidenceTier: calculateConfidenceTier([])
      };
    }
    
    // Get watchable AND eligible games for pick selection
    const eligibleGames = gamesEligibleForPick || games;
    const watchableEligible = eligibleGames.filter(g => isGameWatchable(g.status));
    const confidenceTier = calculateConfidenceTier(watchableEligible, dataFreshness);
    
    // Load existing pick state
    const existingPickState = loadPickState(sport);
    
    // Use Pick State Machine to evaluate/select pick from ELIGIBLE games
    const evaluation = evaluatePick(existingPickState, eligibleGames, confidenceTier, sport);
    
    // No watchable eligible games left
    if (!evaluation.pick) {
      return {
        games, // Still return ALL games for slate display
        pick: null,
        pickState: null,
        message: evaluation.message || `All ${sport.toUpperCase()} games have finished`,
        dataFreshness,
        confidenceTier: calculateConfidenceTier([])
      };
    }
    
    // Get alternate games (next 2-3 best watchable eligible games, excluding pick)
    const alternateGames = watchableEligible
      .filter(g => g.id !== evaluation.pick.id)
      .slice(0, 3);
    
    return {
      games, // Return ALL games for slate display (including finished, tomorrow's games shown but marked)
      pick: {
        id: evaluation.pick.id,
        date: evaluation.pick.gameDate,
        score: evaluation.pick.score,
        whyWatch: evaluation.pick.whyWatch,
        source: 'live',
        game: evaluation.pick,
        validation: evaluation.pick.validation,
        components: evaluation.pick.components,
        supportingReasons: evaluation.pick.supportingReasons,
      },
      pickState: evaluation.pickState,
      alternateGames,
      confidenceTier,
      dataFreshness,
      // Metadata for debugging/UI
      pickMetadata: {
        wasOverridden: evaluation.wasOverridden,
        wasReEvaluated: evaluation.wasReEvaluated,
        wasLocked: evaluation.wasLocked,
        isNewPick: evaluation.isNewPick,
        overrideMessage: evaluation.message,
        isLocked: evaluation.pickState?.pickLocked || false,
        lockReason: evaluation.pickState?.pickLockedReason || null,
      }
    };
  },

  async getTeam(teamId, sport = 'nba') {
    try {
      // Build fetch promises array
      const fetchPromises = [
        fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=team&teamId=${teamId}`),
        fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=roster&teamId=${teamId}`),
        fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=schedule&teamId=${teamId}`)
      ];
      
      // For NFL, also fetch depth chart using numeric team ID
      let depthChartPromise = null;
      if (sport === 'nfl') {
        const teamIdUpper = typeof teamId === 'string' ? teamId.toUpperCase() : teamId;
        const numericTeamId = NFL_TEAM_IDS[teamIdUpper];
        console.log('NFL Depth Chart Debug:', { teamId, teamIdUpper, numericTeamId });
        if (numericTeamId) {
          depthChartPromise = fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=depthchart&teamId=${numericTeamId}`);
          fetchPromises.push(depthChartPromise);
        }
      }
      
      const responses = await Promise.all(fetchPromises);
      const [teamRes, rosterRes, scheduleRes] = responses;
      const depthChartRes = responses[3]; // May be undefined if not NFL
      
      if (!teamRes.ok) {
        throw new Error(`Team fetch failed: ${teamRes.status}`);
      }
      
      const teamData = await teamRes.json();
      const team = teamData.team;
      
      if (!team) {
        throw new Error('Team not found in response');
      }
      
      // Parse depth chart data for NFL
      let depthChartData = null;
      if (sport === 'nfl' && depthChartRes) {
        console.log('Depth chart response:', { ok: depthChartRes.ok, status: depthChartRes.status });
        if (depthChartRes.ok) {
          try {
            depthChartData = await depthChartRes.json();
            console.log('Depth chart data loaded:', depthChartData?.depthchart?.length, 'formations');
          } catch (e) {
            console.error('Depth chart parse error:', e);
            logError(e, { context: 'depthChartParse', sport: sport });
          }
        }
      }
      
      // Parse last 5 games from schedule
      let lastFiveGames = [];
      let todayGame = null;
      let probableStarter = null;
      
      try {
        if (scheduleRes.ok) {
          const scheduleData = await scheduleRes.json();
          const events = scheduleData.events || [];
          const now = new Date();
          const today = now.toDateString();
          
          // Find today's game for MLB starting pitcher
          if (sport === 'mlb') {
            const todayEvent = events.find(e => {
              const gameDate = new Date(e.date);
              return gameDate.toDateString() === today;
            });
            
            if (todayEvent) {
              const comp = todayEvent.competitions?.[0];
              const teamIdStr = String(teamId).toUpperCase();
              const homeTeam = comp?.competitors?.find(c => c.homeAway === 'home');
              const awayTeam = comp?.competitors?.find(c => c.homeAway === 'away');
              const isHome = homeTeam?.team?.abbreviation === teamIdStr || 
                            String(homeTeam?.team?.id) === teamIdStr;
              const ourTeam = isHome ? homeTeam : awayTeam;
              
              // Get probable pitcher from competition data
              const probablePitchers = comp?.probables || [];
              const ourProbable = probablePitchers.find(p => {
                const pitcherTeamId = p.team?.id || p.teamId;
                return String(pitcherTeamId) === String(ourTeam?.team?.id);
              });
              
              if (ourProbable?.athlete) {
                probableStarter = {
                  id: ourProbable.athlete.id,
                  name: ourProbable.athlete.displayName || ourProbable.athlete.fullName,
                  headshot: ourProbable.athlete.headshot?.href,
                  throws: ourProbable.athlete.hand?.abbreviation || ourProbable.athlete.throws,
                  stats: ourProbable.statistics || [],
                  confirmed: true
                };
              }
              
              todayGame = {
                opponent: isHome ? awayTeam?.team?.displayName : homeTeam?.team?.displayName,
                opponentAbbr: isHome ? awayTeam?.team?.abbreviation : homeTeam?.team?.abbreviation,
                time: todayEvent.date,
                isHome: isHome,
                status: comp?.status?.type?.name
              };
            }
          }
          
          // Filter completed games and get last 5
          const completedGames = events
            .filter(e => {
              const status = e.competitions?.[0]?.status;
              // Check if game is completed via status.type.completed OR status.type.name === 'STATUS_FINAL'
              const isCompleted = status?.type?.completed || 
                                  status?.type?.name === 'STATUS_FINAL' ||
                                  status?.type?.state === 'post';
              // Also check if date is in the past
              const gameDate = new Date(e.date);
              const isPast = gameDate < now;
              return isCompleted || isPast;
            })
            .slice(-5)
            .reverse()
            .map(e => {
              const comp = e.competitions[0];
              const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
              const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
              // Check if we're the home team by ID or abbreviation
              const teamIdStr = String(teamId).toUpperCase();
              const isHome = homeTeam?.team?.abbreviation === teamIdStr || 
                            String(homeTeam?.team?.id) === teamIdStr ||
                            homeTeam?.team?.abbreviation === teamId;
              const opponent = isHome ? awayTeam : homeTeam;
              const us = isHome ? homeTeam : awayTeam;
              const won = us?.winner;
              return {
                date: e.date,
                opponent: opponent?.team?.abbreviation || opponent?.team?.displayName,
                opponentLogo: opponent?.team?.logo,
                score: `${us?.score || 0}-${opponent?.score || 0}`,
                won: won,
                isHome: isHome
              };
            });
          lastFiveGames = completedGames;
        }
      } catch (e) {
        console.error('Schedule parse error:', e);
        logError(e, { context: 'scheduleParse', teamId, sport });
      }
      
      // Parse roster - handle both ESPN response formats
      let roster = [];
      let rosterError = null;
      
      try {
        if (rosterRes.ok) {
          const rosterData = await rosterRes.json();
          const athletes = rosterData.athletes || [];
          
          // ESPN returns roster in different formats:
          // Format 1: athletes[] is flat array of player objects (has .id directly)
          // Format 2: athletes[] is array of position groups with .items[] containing players
          
          if (athletes.length > 0) {
            // Check if first item has 'id' (flat format) or 'items' (grouped format)
            const firstAthlete = athletes[0];
            
            if (firstAthlete.id && firstAthlete.displayName) {
              // Format 1: Flat array of players
              roster = athletes.map(player => ({
                id: player.id,
                name: player.displayName || player.fullName,
                firstName: player.firstName,
                lastName: player.lastName,
                position: player.position?.abbreviation || player.position?.name || player.position,
                jersey: player.jersey,
                headshot: player.headshot?.href,
                status: player.injuries?.[0]?.status || 'Active',
                injuryType: player.injuries?.[0]?.type,
                experience: player.experience?.years,
                age: player.age,
                height: player.displayHeight,
                weight: player.displayWeight,
                college: player.college?.name,
                isStarter: player.starter || false
              }));
            } else if (firstAthlete.items || firstAthlete.athletes) {
              // Format 2: Grouped by position
              athletes.forEach(group => {
                const players = group.items || group.athletes || [];
                players.forEach(player => {
                  roster.push({
                    id: player.id,
                    name: player.displayName || player.fullName,
                    firstName: player.firstName,
                    lastName: player.lastName,
                    position: player.position?.abbreviation || player.position?.name || group.position,
                    jersey: player.jersey,
                    headshot: player.headshot?.href,
                    status: player.injuries?.[0]?.status || 'Active',
                    injuryType: player.injuries?.[0]?.type,
                    experience: player.experience?.years,
                    age: player.age,
                    height: player.displayHeight,
                    weight: player.displayWeight,
                    college: player.college?.name,
                    isStarter: player.starter || false
                  });
                });
              });
            }
          }
        } else {
          rosterError = `Roster fetch failed: ${rosterRes.status}`;
        }
      } catch (e) {
        rosterError = e.message;
        console.error('Roster parse error:', e);
        logError(e, { context: 'rosterParse', teamId, sport });
      }
      
      // HARD FIX #1: Update injury cache with roster data
      // This allows future star selections to filter out injured players
      if (roster.length > 0 && teamId) {
        updateInjuryCache(teamId, sport, roster);
      }
      
      // Parse record stats
      const recordStats = team.record?.items?.[0]?.stats || [];
      const getStat = (name) => recordStats.find(s => s.name === name)?.value;
      
      // Calculate per-game stats
      const wins = getStat('wins') || 0;
      const losses = getStat('losses') || 0;
      const gamesPlayed = wins + losses || 1;
      const pointsFor = getStat('pointsFor') || 0;
      const pointsAgainst = getStat('pointsAgainst') || 0;
      const ppg = (pointsFor / gamesPlayed).toFixed(1);
      const oppg = (pointsAgainst / gamesPlayed).toFixed(1);
      
      // Fetch team statistics rankings
      let teamRankings = { strengths: [], weaknesses: [], all: [] };
      try {
        const statsRes = await fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=statistics&teamId=${teamId}`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          
          // Try multiple possible paths in ESPN response
          const categories = statsData.results?.stats?.categories 
            || statsData.splits?.categories 
            || statsData.statistics?.splits?.categories
            || [];
          
          // Extract stats with rankings
          const allStats = [];
          categories.forEach(cat => {
            const catStats = cat.stats || [];
            catStats.forEach(stat => {
              if (stat.rankDisplayValue || stat.rank) {
                const rank = stat.rank || parseInt(stat.rankDisplayValue) || 99;
                if (rank <= 30 && stat.displayValue) {
                  allStats.push({
                    name: stat.displayName || stat.name,
                    shortName: stat.shortDisplayName || stat.abbreviation || stat.name,
                    value: stat.displayValue,
                    rank: rank,
                    category: cat.displayName || cat.name
                  });
                }
              }
            });
          });
          
          if (allStats.length > 0) {
            // Sort by rank (best rankings first)
            const sorted = allStats.sort((a, b) => a.rank - b.rank);
            teamRankings = { 
              strengths: sorted.slice(0, 6), 
              weaknesses: sorted.slice(-3).reverse(), 
              all: allStats 
            };
          }
        }
      } catch (e) {
        console.error('Stats fetch error:', e);
        logError(e, { context: 'statsFetch', teamId, sport });
      }
      
      // Get next event status
      const nextEvent = team.nextEvent?.[0];
      let gameStatus = 'off';
      let liveScore = null;
      if (nextEvent) {
        const eventDate = new Date(nextEvent.date);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        if (eventDate.toDateString() === today.toDateString()) {
          gameStatus = 'today';
        } else if (eventDate.toDateString() === tomorrow.toDateString()) {
          gameStatus = 'tomorrow';
        }
        
        const status = nextEvent.competitions?.[0]?.status?.type?.name;
        if (status && !status.toLowerCase().includes('scheduled') && !status.toLowerCase().includes('final')) {
          gameStatus = 'live';
          const competitors = nextEvent.competitions?.[0]?.competitors || [];
          liveScore = competitors.map(c => ({
            team: c.team?.abbreviation,
            score: c.score,
            isHome: c.homeAway === 'home'
          }));
        }
      }
      
      // Get injuries from roster
      const injuries = roster
        .filter(p => p.status && p.status !== 'Active' && p.status !== 'active')
        .slice(0, 5)
        .map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
          type: p.injuryType
        }));
      
      // Sort roster based on sport (passing depth chart data for NFL)
      const sortedRoster = sortRosterBySport(roster, sport, depthChartData);
      
      return {
        team: {
          id: team.id,
          name: team.displayName,
          nickname: team.name,
          abbreviation: team.abbreviation,
          logo_url: team.logos?.[0]?.href,
          color: team.color,
          alternateColor: team.alternateColor,
          record: team.record?.items?.[0]?.summary || '',
          standing: team.standingSummary || '',
          venue: team.franchise?.venue?.fullName,
          location: team.location,
          
          // Stats (per-game calculated)
          ppg: ppg,
          oppg: oppg,
          pace: getStat('pace'),
          wins: wins,
          losses: losses,
          streak: getStat('streak'),
          lastFive: team.record?.items?.find(r => r.type === 'lastten')?.summary,
          lastFiveGames: lastFiveGames,
          rankings: teamRankings,
          
          // Status
          gameStatus,
          liveScore,
          nextGame: nextEvent ? {
            opponent: nextEvent.competitions?.[0]?.competitors?.find(c => c.team?.id !== team.id)?.team?.displayName,
            date: nextEvent.date,
            isHome: nextEvent.competitions?.[0]?.competitors?.find(c => c.team?.id === team.id)?.homeAway === 'home'
          } : null,
          
          // MLB-specific data
          todayGame: todayGame,
          probableStarter: probableStarter,
          
          // Roster & Injuries
          roster: sortedRoster,
          rosterError,
          injuries,
          
          // Metadata
          lastUpdated: new Date().toISOString()
        }
      };
    } catch (err) {
      console.error('Team fetch failed:', err);
      logError(err, { context: 'teamFetch', teamId, sport });
      return { team: null, error: err.message };
    }
  },

  async getPlayer(playerId, sport = 'nba') {
    try {
      const res = await fetch(`${ESPN_PROXY}?sport=${sport}&endpoint=player&playerId=${playerId}`);
      const data = await res.json();
      const athlete = data.athlete;
      
      // Get current season stats
      const currentStats = athlete.statisticsLog?.statistics?.find(s => 
        s.season?.year === new Date().getFullYear() || s.season?.displayName?.includes('2024-25')
      );
      
      // Parse stats based on sport
      let stats = {};
      const statCategories = currentStats?.statistics || [];
      
      if (sport === 'nba') {
        const perGame = statCategories.find(c => c.name === 'perGame' || c.type === 'perGame');
        if (perGame) {
          const getStatVal = (name) => perGame.stats?.find(s => s.name === name)?.value;
          stats = {
            ppg: getStatVal('avgPoints') || getStatVal('points'),
            rpg: getStatVal('avgRebounds') || getStatVal('rebounds'),
            apg: getStatVal('avgAssists') || getStatVal('assists'),
            spg: getStatVal('avgSteals'),
            bpg: getStatVal('avgBlocks'),
            fgPct: getStatVal('fieldGoalPct'),
            threePct: getStatVal('threePointFieldGoalPct'),
            ftPct: getStatVal('freeThrowPct'),
            mpg: getStatVal('avgMinutes')
          };
        }
      } else if (sport === 'nfl') {
        const totals = statCategories.find(c => c.name === 'totals' || c.type === 'totals');
        if (totals) {
          const getStatVal = (name) => totals.stats?.find(s => s.name === name)?.value;
          stats = {
            passingYards: getStatVal('passingYards'),
            passingTDs: getStatVal('passingTouchdowns'),
            rushingYards: getStatVal('rushingYards'),
            rushingTDs: getStatVal('rushingTouchdowns'),
            receivingYards: getStatVal('receivingYards'),
            receivingTDs: getStatVal('receivingTouchdowns'),
            receptions: getStatVal('receptions'),
            tackles: getStatVal('totalTackles'),
            sacks: getStatVal('sacks'),
            interceptions: getStatVal('interceptions')
          };
        }
      } else if (sport === 'mlb') {
        const totals = statCategories.find(c => c.name === 'batting' || c.type === 'batting');
        if (totals) {
          const getStatVal = (name) => totals.stats?.find(s => s.name === name)?.value;
          stats = {
            avg: getStatVal('avg'),
            hr: getStatVal('homeRuns'),
            rbi: getStatVal('RBIs'),
            runs: getStatVal('runs'),
            hits: getStatVal('hits'),
            sb: getStatVal('stolenBases'),
            obp: getStatVal('OBP'),
            slg: getStatVal('sluggingPct'),
            ops: getStatVal('OPS')
          };
        }
      }
      
      // Recent games
      const gameLog = athlete.gameLog?.events || [];
      const recentGames = gameLog.slice(0, 5).map(game => ({
        date: game.gameDate,
        opponent: game.opponent?.abbreviation,
        result: game.gameResult,
        stats: game.stats
      }));
      
      return {
        player: {
          id: athlete.id,
          name: athlete.displayName,
          firstName: athlete.firstName,
          lastName: athlete.lastName,
          position: athlete.position?.abbreviation || athlete.position?.name,
          jersey: athlete.jersey,
          headshot: athlete.headshot?.href,
          team: {
            id: athlete.team?.id,
            name: athlete.team?.displayName,
            abbreviation: athlete.team?.abbreviation,
            logo: athlete.team?.logos?.[0]?.href
          },
          
          // Bio
          age: athlete.age,
          height: athlete.displayHeight,
          weight: athlete.displayWeight,
          birthDate: athlete.dateOfBirth,
          birthPlace: athlete.birthPlace?.city ? `${athlete.birthPlace.city}, ${athlete.birthPlace.state || athlete.birthPlace.country}` : null,
          college: athlete.college?.name,
          experience: athlete.experience?.years,
          draft: athlete.draft ? `${athlete.draft.year} Round ${athlete.draft.round}, Pick ${athlete.draft.selection}` : null,
          
          // Status
          status: athlete.injuries?.[0]?.status || 'active',
          injuryType: athlete.injuries?.[0]?.type,
          injuryDetails: athlete.injuries?.[0]?.longComment,
          
          // Stats
          stats,
          recentGames,
          
          // Metadata
          lastUpdated: new Date().toISOString()
        }
      };
    } catch (err) {
      console.error('Player fetch failed:', err);
      logError(err, { context: 'playerFetch', playerId, sport });
      return { player: null, error: err.message };
    }
  },

  async getChallengeToday(sport = 'nba') {
    // Get Tonight's Pick - that's the only game you can vote on
    const pickRes = await this.getPicksToday(sport);
    if (!pickRes.pick) return { challenge: null };
    
    const challengeGame = pickRes.pick.game;
    const now = new Date();
    
    const getStartTime = (game) => new Date(game.startTime);
    const hasStarted = (game) => now >= getStartTime(game);
    const isFinal = (game) => {
      const status = (game.status || '').toLowerCase();
      return status.includes('final') || status.includes('post');
    };
    
    const gameStarted = hasStarted(challengeGame);
    const gameFinished = isFinal(challengeGame);
    
    // Determine winner if game is finished
    let winner = null;
    if (gameFinished && challengeGame.homeScore !== null && challengeGame.awayScore !== null) {
      winner = challengeGame.homeScore > challengeGame.awayScore ? 'home' : 'away';
    }
    
    return {
      challenge: {
        id: `${sport}-${challengeGame.id}`,
        date: challengeGame.gameDate,
        question: gameFinished ? 'Final Result' : (gameStarted ? 'Game in Progress' : 'Who wins tonight?'),
        gameStarted: gameStarted,
        gameFinished: gameFinished,
        winner: winner,
        homeScore: challengeGame.homeScore,
        awayScore: challengeGame.awayScore,
        game: {
          id: challengeGame.id,
          startTime: challengeGame.startTime,
          status: challengeGame.status,
          homeTeam: challengeGame.homeTeam,
          awayTeam: challengeGame.awayTeam,
        },
        options: [
          { value: 'away', label: challengeGame.awayTeam.name },
          { value: 'home', label: challengeGame.homeTeam.name },
        ],
      }
    };
  },

  async submitChallenge(challengeId, prediction) {
    // Store prediction with challenge ID to handle multiple days
    const key = `gn_prediction_${challengeId}`;
    if (localStorage.getItem(key)) {
      return { success: false, error: 'Already voted' };
    }
    localStorage.setItem(key, prediction);
    
    const stats = JSON.parse(localStorage.getItem('gn_stats') || '{"points":0,"streak":0}');
    localStorage.setItem('gn_stats', JSON.stringify(stats));
    return { success: true, prediction };
  },

  async getUserPrediction(challengeId) {
    const key = `gn_prediction_${challengeId}`;
    return localStorage.getItem(key);
  },

  async getUserStats() {
    const stats = JSON.parse(localStorage.getItem('gn_stats') || '{"points":0,"streak":0,"accuracy":0}');
    return { stats, isPremium: false };
  }
};

// ============================================
// Icons
// ============================================
const Icons = {
  Trophy: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>,
  Bell: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  BarChart: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  User: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Target: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Home: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Tv: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>,
  Check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  ChevronLeft: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  ChevronRight: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  Flame: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>,
  X: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Mail: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
  Shield: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  HelpCircle: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>,
  FileText: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  ExternalLink: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Crown: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 16h18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2z"/></svg>,
  Settings: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  TrendingUp: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  Award: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>,
  LogOut: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Calendar: () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  AlertCircle: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  RefreshCw: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  Loader: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{animation: 'spin 1s linear infinite'}}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>,
  Live: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>,
};

// ============================================
// Reduced Motion Hook
// ============================================
const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
};

// ============================================
// Skeleton Loading Component
// ============================================
const Skeleton = ({ className = '', width, height, rounded = 'rounded-lg' }) => (
  <div 
    className={`skeleton ${rounded} ${className}`}
    style={{ width: width || '100%', height: height || '20px' }}
  />
);

// Card Skeleton for game cards
const GameCardSkeleton = () => (
  <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 mb-4">
    <div className="flex items-center justify-between mb-6">
      <Skeleton width="120px" height="12px" rounded="rounded-full" />
      <Skeleton width="40px" height="20px" rounded="rounded-full" />
    </div>
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Skeleton width="56px" height="56px" rounded="rounded-full" />
        <div>
          <Skeleton width="100px" height="16px" className="mb-2" />
          <Skeleton width="40px" height="12px" />
        </div>
      </div>
      <Skeleton width="20px" height="14px" />
      <div className="flex items-center gap-3">
        <div className="text-right">
          <Skeleton width="100px" height="16px" className="mb-2" />
          <Skeleton width="40px" height="12px" />
        </div>
        <Skeleton width="56px" height="56px" rounded="rounded-full" />
      </div>
    </div>
    <Skeleton width="100%" height="16px" className="mb-4" />
    <div className="flex gap-3">
      <Skeleton width="100%" height="48px" rounded="rounded-2xl" />
      <Skeleton width="100%" height="48px" rounded="rounded-2xl" />
    </div>
  </div>
);

// ============================================
// Animated Button - Polished
// ============================================
const AnimatedButton = ({ children, primary, className, onClick, disabled }) => {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => !disabled && setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      className={`${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={{
        transform: !reducedMotion && pressed && !disabled ? `scale(${primary ? 0.97 : 0.98})` : 'scale(1)',
        opacity: disabled ? 0.5 : (pressed ? 0.9 : 1),
        transition: reducedMotion ? 'none' : 'transform 150ms ease, opacity 150ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </button>
  );
};

// ============================================
// Roster Row Component - Clean & Scannable
// ============================================
const RosterRow = ({ player, onClick, isStarter, sport, battingOrder, showPitcherHand, isInferred }) => {
  // Guard: Handle null/undefined player
  if (!player) {
    return null;
  }
  
  const isInjured = player.status && player.status !== 'Active' && player.status !== 'active';
  const playerName = player.name || 'Unknown Player';
  const playerPosition = player.position || 'N/A';
  
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-left group
        ${isStarter 
          ? 'bg-white/[0.03] hover:bg-white/[0.06]' 
          : 'bg-transparent hover:bg-white/[0.03]'
        }
        ${isInjured ? 'opacity-60' : ''}
      `}
    >
      {/* Batting Order Number (MLB) */}
      {battingOrder && (
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">
          {battingOrder}
        </div>
      )}
      
      {/* Player Photo or Jersey */}
      {player.headshot ? (
        <img 
          src={player.headshot} 
          alt="" 
          className={`w-10 h-10 rounded-full object-cover ${isStarter && !isInferred ? 'ring-2 ring-blue-500/30' : isInferred ? 'ring-2 ring-yellow-500/20' : 'bg-white/10'}`}
        />
      ) : (
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold 
          ${isStarter && !isInferred
            ? 'bg-gradient-to-br from-blue-600/30 to-blue-800/30 text-blue-300' 
            : isInferred 
            ? 'bg-gradient-to-br from-yellow-600/20 to-yellow-800/20 text-yellow-400'
            : 'bg-gradient-to-br from-gray-700 to-gray-800 text-gray-400'
          }`}
        >
          {player.jersey || playerName.charAt(0) || '?'}
        </div>
      )}
      
      {/* Player Info */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate flex items-center gap-1.5 ${isStarter ? 'font-semibold text-white' : 'font-medium text-gray-300'}`}>
          {playerName}
          {isInferred && (
            <span className="text-[9px] text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">PROJ</span>
          )}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-1.5">
          <span className="font-medium">{playerPosition}</span>
          {player.jersey && <span>#{player.jersey}</span>}
          {showPitcherHand && player.throws && <span className="text-gray-600">• {player.throws === 'L' ? 'LHP' : 'RHP'}</span>}
        </div>
      </div>
      
      {/* Status Badge */}
      {isInjured && (
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
          player.status === 'Out' ? 'bg-red-500/20 text-red-400' : 
          player.status === 'Doubtful' ? 'bg-orange-500/20 text-orange-400' :
          'bg-yellow-500/20 text-yellow-400'
        }`}>
          {player.status}
        </span>
      )}
      
      {/* Chevron */}
      <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
};

// ============================================
// Format Time
// ============================================
const formatTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET';
};

// ============================================
// LEADERBOARD (mock for now)
// ============================================
const LEADERBOARD = [
  { name: 'MikeTheSharp', points: 2400, streak: 12 },
  { name: 'BballFan92', points: 1850, streak: 8 },
  { name: 'Courtside_Chris', points: 1200, streak: 5 },
];

// ============================================
// Main App
// ============================================
export default function GamenightApp() {
  const reducedMotion = useReducedMotion();
  
  // UI State
  const [activeTab, setActiveTab] = useState('tonight');
  const [activeSport, setActiveSport] = useState('nba');
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamDetails, setTeamDetails] = useState(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState(null);
  const [teamTab, setTeamTab] = useState('stats'); // 'stats' or 'roster'
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetails, setPlayerDetails] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [toast, setToast] = useState(null);
  const [appLoaded, setAppLoaded] = useState(false);
  
  // Data State
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [pick, setPick] = useState(null);
  const [pickState, setPickState] = useState(null); // Pick State Machine state
  const [pickMetadata, setPickMetadata] = useState(null); // Pick lifecycle metadata
  const [alternateGames, setAlternateGames] = useState([]); // Next 2-3 best games
  const [games, setGames] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [userStats, setUserStats] = useState({ points: 0, streak: 0, accuracy: 0 });
  const [userPrediction, setUserPrediction] = useState(null); // User's locked-in vote
  const [showMLBOtherPlayers, setShowMLBOtherPlayers] = useState(false); // MLB roster collapse state
  const [showNFLDepth, setShowNFLDepth] = useState(false); // NFL depth players collapse
  const [showNFLInjured, setShowNFLInjured] = useState(false); // NFL injured players collapse
  const [isOffline, setIsOffline] = useState(!navigator.onLine); // Network status
  const [lastUpdated, setLastUpdated] = useState(null); // When data was last fetched
  
  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  // Settings (local)
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('gn_settings');
    return saved ? JSON.parse(saved) : { bettingSignals: false, notifications: true, emailAlerts: false, premium: false };
  });
  
  // Challenge state
  const [selectedPrediction, setSelectedPrediction] = useState(null); // Currently selected (before submit)
  const [submitting, setSubmitting] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false); // Track if loading took too long

  // Save settings
  useEffect(() => {
    localStorage.setItem('gn_settings', JSON.stringify(settings));
  }, [settings]);

  // Load data on mount and sport change
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setLoadError(null);
      setLoadingTimeout(false);
      
      // Set timeout - if loading takes > 15 seconds, show retry option
      const timeoutId = setTimeout(() => {
        setLoadingTimeout(true);
      }, 15000);
      
      try {
        // P0 FIX: Single fetch for games and pick (eliminates double-fetch race condition)
        const [gamesAndPickRes, challengeRes, statsRes] = await Promise.all([
          api.getGamesAndPick(activeSport),
          api.getChallengeToday(activeSport),
          api.getUserStats()
        ]);
        
        clearTimeout(timeoutId);
        
        // Check for errors in responses (exclude valid states like "no games" or "all finished")
        const validMessages = [
          `No ${activeSport.toUpperCase()} games today`,
          `All ${activeSport.toUpperCase()} games have finished`
        ];
        if (gamesAndPickRes.message && !validMessages.includes(gamesAndPickRes.message)) {
          setLoadError(gamesAndPickRes.message);
        }
        
        // Include confidenceTier in pick object
        const pickWithTier = gamesAndPickRes.pick ? {
          ...gamesAndPickRes.pick,
          confidenceTier: gamesAndPickRes.confidenceTier
        } : null;
        
        setPick(pickWithTier);
        setPickState(gamesAndPickRes.pickState || null);
        setPickMetadata(gamesAndPickRes.pickMetadata || null);
        setAlternateGames(gamesAndPickRes.alternateGames || []);
        setGames(gamesAndPickRes.games || []);
        setChallenge(challengeRes.challenge);
        setUserStats(statsRes.stats || { points: 0, streak: 0, accuracy: 0 });
        setLastUpdated(new Date()); // Track when data was loaded
        
        // Log pick state changes for debugging
        if (gamesAndPickRes.pickMetadata) {
          const meta = gamesAndPickRes.pickMetadata;
          if (meta.wasOverridden) {
            console.log('[Gamenight UI] Pick was overridden:', meta.overrideMessage);
          }
          if (meta.wasLocked) {
            console.log('[Gamenight UI] Pick was locked:', meta.lockReason);
          }
          if (meta.wasReEvaluated) {
            console.log('[Gamenight UI] Pick was re-evaluated (pre-lock)');
          }
        }
        
        // Load user's prediction for this challenge
        if (challengeRes.challenge?.id) {
          const prediction = await api.getUserPrediction(challengeRes.challenge.id);
          setUserPrediction(prediction);
          setSelectedPrediction(prediction); // Show their pick as selected
        }
      } catch (err) {
        logError(err, { action: 'loadData', sport: activeSport });
        setLoadError(err.message || 'Failed to load data');
      }
      setLoading(false);
      setAppLoaded(true);
    };
    loadData();
  }, [activeSport]);

  // Fetch team details when team is selected
  useEffect(() => {
    if (selectedTeam) {
      setTeamLoading(true);
      setTeamDetails(null);
      setTeamError(null);
      api.getTeam(selectedTeam.abbreviation || selectedTeam.id, activeSport)
        .then(res => {
          if (res.error || !res.team) {
            setTeamError(res.error || 'Failed to load team');
          } else {
            setTeamDetails(res.team);
          }
          setTeamLoading(false);
        })
        .catch(err => {
          setTeamError(err.message || 'Failed to load team');
          setTeamLoading(false);
        });
    }
  }, [selectedTeam, activeSport]);

  // Fetch player details when player is selected
  useEffect(() => {
    if (selectedPlayer) {
      setPlayerLoading(true);
      setPlayerDetails(null);
      api.getPlayer(selectedPlayer.id, activeSport)
        .then(res => {
          setPlayerDetails(res.player);
          setPlayerLoading(false);
        })
        .catch(() => setPlayerLoading(false));
    }
  }, [selectedPlayer, activeSport]);

  const showToastMsg = useCallback((msg) => { 
    setToast(msg); 
    setTimeout(() => setToast(null), 2500); 
  }, []);

  const handlePrediction = (pred) => {
    // Can only select if: no existing prediction AND game hasn't started
    if (!userPrediction && !challenge?.gameStarted && !submitting) {
      setSelectedPrediction(pred);
    }
  };

  const submitPrediction = async () => {
    if (!selectedPrediction || userPrediction || challenge?.gameStarted || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.submitChallenge(challenge.id, selectedPrediction);
      if (res.success) {
        setUserPrediction(selectedPrediction);
        showToastMsg('Prediction locked! Good luck!');
      } else {
        showToastMsg(res.error || 'Failed to submit');
      }
    } catch (err) {
      showToastMsg('Failed to submit prediction');
    }
    setSubmitting(false);
  };

  const toggleSetting = (key) => {
    if (key === 'premium') {
      setShowPaywall(true);
    } else {
      setSettings(p => ({ ...p, [key]: !p[key] }));
    }
  };

  // Derived data
  const bestGame = pick?.game;
  // Use alternateGames from Pick State Machine if available, otherwise compute from games
  const honorableMentions = alternateGames.length > 0 
    ? alternateGames 
    : games.filter(g => g.id !== bestGame?.id).slice(0, 3);
  const leaderboard = [...LEADERBOARD, { name: 'You', points: userStats.points, streak: userStats.streak, isUser: true }]
    .sort((a, b) => b.points - a.points);

  return (
    <div 
      className="text-white min-h-screen"
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        background: '#0a0a0f',
        paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))',
        opacity: reducedMotion ? 1 : (appLoaded ? 1 : 0),
        transition: reducedMotion ? 'none' : 'opacity 300ms ease',
      }}
    >
      {/* Offline Banner */}
      {isOffline && (
        <div className="bg-yellow-500/90 text-black text-center py-2 px-4 text-sm font-medium sticky top-0 z-[100]">
          📡 You're offline - showing cached data
        </div>
      )}
      
      {/* Header */}
      <header className="bg-[#0a0a0f]/90 backdrop-blur-xl p-4 border-b border-white/5 sticky top-0 z-50">
        <div className="flex justify-between items-center max-w-md mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/30">
              <Icons.Trophy />
            </div>
            <span className="text-xl font-bold">Gamenight</span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
              <Icons.Live /> LIVE
            </span>
          </div>
          <div className="flex gap-2">
            <AnimatedButton 
              onClick={() => { setActiveTab('settings'); window.scrollTo(0, 0); }} 
              className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${activeTab === 'settings' ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-gray-400'}`}
            >
              <Icons.Settings />
            </AnimatedButton>
            <AnimatedButton 
              onClick={() => setShowNotifications(true)} 
              className="w-11 h-11 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-gray-400 relative"
            >
              <Icons.Bell />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-orange-500 rounded-full" />
            </AnimatedButton>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-md mx-auto p-5">
        
        {/* Loading State */}
        {loading && (
          <div className="animate-fadeIn">
            {/* Skeleton loading - feels more premium than spinner */}
            <div className="flex gap-2 p-1 bg-white/[0.02] rounded-3xl border border-white/5 mb-6">
              {['nba', 'nfl', 'mlb'].map(s => (
                <div key={s} className="flex-1 py-3.5 rounded-2xl">
                  <Skeleton width="100%" height="20px" rounded="rounded-2xl" />
                </div>
              ))}
            </div>
            <GameCardSkeleton />
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Also Tonight</div>
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton width="32px" height="32px" rounded="rounded-full" />
                    <Skeleton width="12px" height="12px" rounded="rounded-full" />
                    <Skeleton width="32px" height="32px" rounded="rounded-full" />
                    <div className="flex-1" />
                    <Skeleton width="60px" height="16px" />
                  </div>
                </div>
              ))}
            </div>
            
            {/* Timeout retry option */}
            {loadingTimeout && (
              <div className="text-center mt-8 animate-fadeIn">
                <p className="text-yellow-400 text-sm mb-3">Taking longer than expected...</p>
                <button
                  onClick={() => {
                    setLoading(true);
                    setLoadingTimeout(false);
                    setLoadError(null);
                    const currentSport = activeSport;
                    setActiveSport(currentSport === 'nba' ? 'nfl' : 'nba');
                    setTimeout(() => setActiveSport(currentSport), 100);
                  }}
                  className="px-5 py-2.5 bg-white/10 hover:bg-white/15 rounded-full text-sm font-medium transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tonight Tab */}
        {!loading && activeTab === 'tonight' && (
          <div className="animate-fadeIn">
            {/* Sport Pills */}
            <div className="flex gap-2 p-1 bg-white/[0.02] rounded-3xl border border-white/5 mb-6">
              {['nba', 'nfl', 'mlb'].map(s => (
                <AnimatedButton 
                  key={s} 
                  onClick={() => setActiveSport(s)} 
                  className={`flex-1 py-3.5 rounded-2xl text-sm font-semibold transition-all ${activeSport === s ? 'bg-white text-black shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  {s.toUpperCase()}
                </AnimatedButton>
              ))}
            </div>

            {bestGame ? (
              <>
                {/* Best Game Card */}
                <div className="bg-gradient-to-b from-white/5 to-white/[0.02] border border-white/5 rounded-3xl p-6 mb-6 relative overflow-hidden">
                  <div className={`absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent ${
                    pick?.confidenceTier?.tier === 'CLEAR' ? 'via-green-500' : 
                    pick?.confidenceTier?.tier === 'SOLID' ? 'via-orange-500' : 'via-gray-500'
                  } to-transparent opacity-60`} />
                  
                  <div className="flex justify-between items-center mb-5">
                    <div>
                      <span className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 ${
                        pick?.confidenceTier?.tier === 'CLEAR' ? 'text-green-400' :
                        pick?.confidenceTier?.tier === 'SOLID' ? 'text-orange-400' : 'text-gray-400'
                      }`}>
                        <span className={`w-2 h-2 rounded-full animate-pulse ${
                          pick?.confidenceTier?.tier === 'CLEAR' ? 'bg-green-500' :
                          pick?.confidenceTier?.tier === 'SOLID' ? 'bg-orange-500' : 'bg-gray-500'
                        }`} />
                        {pick?.confidenceTier?.header || "Tonight's Pick"}
                        {/* Lock icon when pick is frozen */}
                        {pickMetadata?.isLocked && (
                          <span className="ml-1 text-gray-500" title={`Pick locked: ${pickMetadata.lockReason}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                          </span>
                        )}
                      </span>
                      {pick?.confidenceTier?.subtext && (
                        <div className="text-[10px] text-gray-500 mt-1">
                          {pick.confidenceTier.subtext}
                          {/* P1 FIX: Subtle indicator when data quality is degraded */}
                          {bestGame.validation?.fallbackMode && (
                            <span className="ml-1 text-yellow-600/70" title="Some game data unavailable">*</span>
                          )}
                        </div>
                      )}
                      {/* Show override message if pick was changed due to drastic event */}
                      {pickMetadata?.wasOverridden && pickMetadata?.overrideMessage && (
                        <div className="text-[10px] text-yellow-500/80 mt-1 flex items-center gap-1">
                          <span>⚠</span> {pickMetadata.overrideMessage}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="text-[9px] text-gray-500 uppercase tracking-wide">Watchability</div>
                        <span className={`text-lg font-extrabold ${
                          bestGame.score >= 75 ? 'text-green-400' :
                          bestGame.score >= 60 ? 'text-orange-400' : 'text-gray-400'
                        }`}>{bestGame.score}</span>
                      </div>
                      <span className="text-xs font-semibold text-gray-400 px-3 py-1.5 bg-white/5 rounded-xl">{activeSport.toUpperCase()}</span>
                    </div>
                  </div>

                  <div className="space-y-2 mb-5">
                    {[bestGame.awayTeam, bestGame.homeTeam].map((team, i) => (
                      <React.Fragment key={team?.id || i}>
                        <div 
                          onClick={() => { setSelectedTeam(team); setTeamTab('stats'); }} 
                          className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl cursor-pointer hover:bg-white/[0.05] transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/5 overflow-hidden">
                              <img src={team?.logo_url} alt={team?.abbreviation} className="w-9 h-9 object-contain" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <div>
                              <div className="font-bold">{team?.name}</div>
                              <div className="text-sm text-gray-500">{team?.record}</div>
                            </div>
                          </div>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wide px-3 py-1.5 bg-white/[0.03] rounded-lg">{i === 0 ? 'Away' : 'Home'}</span>
                        </div>
                        {i === 0 && <div className="flex justify-center py-1"><span className="text-[10px] font-bold text-gray-500 px-4 py-1.5 bg-white/[0.03] rounded-lg tracking-wider">VS</span></div>}
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="text-center mb-5 p-5 bg-white/[0.03] rounded-2xl">
                    {/* Show live score if game in progress or finished */}
                    {bestGame.status !== 'STATUS_SCHEDULED' && bestGame.homeScore !== null && (
                      <div className="mb-3">
                        <div className="text-3xl font-extrabold mb-1">
                          {bestGame.awayScore} - {bestGame.homeScore}
                        </div>
                        <span className={`text-sm px-3 py-1 rounded-full ${
                          isGameFinal(bestGame.status) 
                            ? 'bg-gray-500/20 text-gray-400' 
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {getGameStatusText(bestGame.status)}
                        </span>
                      </div>
                    )}
                    {bestGame.status === 'STATUS_SCHEDULED' && (
                      <div className="text-2xl font-extrabold mb-2">{formatTime(bestGame.startTime)}</div>
                    )}
                    {bestGame.network && (
                      <div className="inline-flex items-center gap-2 text-sm text-gray-400 px-4 py-2 bg-white/5 rounded-xl">
                        <Icons.Tv /> {bestGame.network}
                      </div>
                    )}
                  </div>

                  <div className={`bg-gradient-to-br ${
                    pick?.confidenceTier?.tier === 'CLEAR' ? 'from-green-500/10 to-green-500/5 border-green-500/20' :
                    pick?.confidenceTier?.tier === 'SOLID' ? 'from-orange-500/10 to-orange-500/5 border-orange-500/20' :
                    'from-gray-500/10 to-gray-500/5 border-gray-500/20'
                  } border rounded-2xl p-4 mb-5`}>
                    <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${
                      pick?.confidenceTier?.tier === 'CLEAR' ? 'text-green-400' :
                      pick?.confidenceTier?.tier === 'SOLID' ? 'text-orange-400' : 'text-gray-400'
                    }`}>Why Watch</div>
                    <div className="text-sm leading-relaxed mb-3">{pick?.whyWatch || bestGame.whyWatch}</div>
                    
                    {/* Supporting Reasons - filtered to not repeat whyWatch */}
                    {bestGame.supportingReasons && bestGame.supportingReasons.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
                        {bestGame.supportingReasons
                          .filter(reason => {
                            // Don't show if this reason is already in whyWatch
                            const whyWatch = (pick?.whyWatch || bestGame.whyWatch || '').toLowerCase();
                            const reasonLower = reason.toLowerCase();
                            // Check for substantial overlap
                            const reasonWords = reasonLower.split(' ').filter(w => w.length > 4);
                            const overlapCount = reasonWords.filter(w => whyWatch.includes(w)).length;
                            // If more than half the significant words overlap, skip
                            return overlapCount < reasonWords.length / 2;
                          })
                          .slice(0, 3)
                          .map((reason, i) => (
                          <span key={i} className="text-[10px] text-gray-400 px-2 py-1 bg-white/5 rounded-lg">
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Watchability Score Breakdown - NOT a win prediction */}
                  {bestGame.components && (
                    <div className="grid grid-cols-5 gap-1 mb-5 p-3 bg-white/[0.02] rounded-xl">
                      {[
                        { key: 'stakes', label: 'Stakes', max: 30 },
                        { key: 'starPower', label: 'Stars', max: 20 },
                        { key: 'competitiveness', label: 'Close', max: 20 },
                        { key: 'narrative', label: 'Story', max: 20 },
                        { key: 'accessibility', label: 'Access', max: 10 }
                      ].map(({ key, label, max }) => {
                        const val = bestGame.components[key] || 0;
                        const pct = (val / max) * 100;
                        return (
                          <div key={key} className="text-center">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">{label}</div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-1">
                              <div 
                                className={`h-full rounded-full ${pct >= 70 ? 'bg-green-500' : pct >= 50 ? 'bg-orange-500' : 'bg-gray-500'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="text-[10px] font-semibold text-gray-400">{val}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {bestGame.signals && (
                    <div className="grid grid-cols-2 gap-2.5 mb-5">
                      {Object.entries(bestGame.signals).filter(([k, v]) => v).map(([k, v]) => {
                        // Map signal keys to proper display labels
                        // Most sport-specific labels (QB Matchup, Key Players, etc.) are already human-readable
                        const labelMap = {
                          standingsRelevance: 'Standings',
                          rivalry: 'Rivalry',
                          // Legacy keys (shouldn't appear anymore but kept for safety)
                          starMatchup: 'Star Matchup',
                          featuredPlayers: 'Players to Watch',
                        };
                        // Use labelMap if exists, otherwise use key as-is (already human-readable from matchupLabel)
                        const label = labelMap[k] || k;
                        
                        return (
                          <div key={k} className="bg-white/[0.03] border border-white/5 rounded-2xl p-3.5">
                            <div className="text-[10px] text-gray-500 uppercase mb-1">{label}</div>
                            <div className={`text-sm font-semibold ${String(v).includes('High') ? 'text-emerald-400' : 'text-amber-400'}`}>{v}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex gap-3 mb-4">
                    <AnimatedButton 
                      primary 
                      onClick={() => {
                        // Open streaming search for this game
                        const searchQuery = encodeURIComponent(`${bestGame.awayTeam?.name} vs ${bestGame.homeTeam?.name} live stream`);
                        window.open(`https://www.google.com/search?q=${searchQuery}`, '_blank');
                      }}
                      className="flex-1 py-3.5 bg-white text-black rounded-2xl font-semibold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-white/10 transition-shadow"
                    >
                      <Icons.Tv /> Watch Live
                    </AnimatedButton>
                    <AnimatedButton 
                      onClick={() => {
                        // Open ESPN game page for odds/info
                        const espnUrl = `https://www.espn.com/${activeSport}/game/_/gameId/${bestGame.id}`;
                        window.open(espnUrl, '_blank');
                      }}
                      className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-orange-500/10 hover:border-orange-500/30 hover:text-orange-400 transition-colors"
                    >
                      <Icons.ExternalLink /> Game Info
                    </AnimatedButton>
                  </div>
                  
                  {/* Betting Disclaimer */}
                  <div className="text-[11px] text-gray-500 text-center leading-relaxed">
                    Game information is for entertainment purposes only. No real-money gambling occurs in this app.
                  </div>
                </div>

                {/* Honorable Mentions */}
                {honorableMentions.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Also Tonight ({games.length} games)</div>
                    <div className="space-y-2">
                      {honorableMentions.map(g => (
                        <div key={g.id} className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <img 
                                  src={g.awayTeam?.logo_url} 
                                  alt="" 
                                  className="w-8 h-8 object-contain cursor-pointer hover:scale-110 transition-transform" 
                                  onClick={() => { setSelectedTeam(g.awayTeam); setTeamTab('stats'); }}
                                />
                                <span className="text-xs text-gray-500">@</span>
                                <img 
                                  src={g.homeTeam?.logo_url} 
                                  alt="" 
                                  className="w-8 h-8 object-contain cursor-pointer hover:scale-110 transition-transform" 
                                  onClick={() => { setSelectedTeam(g.homeTeam); setTeamTab('stats'); }}
                                />
                              </div>
                              <div>
                                <div className="text-sm font-semibold">
                                  <span 
                                    className="cursor-pointer hover:text-blue-400 transition-colors"
                                    onClick={() => { setSelectedTeam(g.awayTeam); setTeamTab('stats'); }}
                                  >
                                    {g.awayTeam?.abbreviation}
                                  </span>
                                  {' @ '}
                                  <span 
                                    className="cursor-pointer hover:text-blue-400 transition-colors"
                                    onClick={() => { setSelectedTeam(g.homeTeam); setTeamTab('stats'); }}
                                  >
                                    {g.homeTeam?.abbreviation}
                                  </span>
                                </div>
                                {g.status === 'STATUS_SCHEDULED' ? (
                                  <div className="text-xs text-gray-500">{formatTime(g.startTime)} {g.network && `• ${g.network}`}</div>
                                ) : (
                                  <div className="text-xs">
                                    <span className="font-bold">{g.awayScore} - {g.homeScore}</span>
                                    <span className={`ml-2 ${isGameFinal(g.status) ? 'text-gray-500' : 'text-red-400'}`}>
                                      {getGameStatusText(g.status)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[8px] text-gray-600 uppercase tracking-wide">Watch</div>
                              <span className="text-lg font-extrabold text-gray-500">{g.score}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16 animate-fadeIn">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-5 text-gray-500">
                  <Icons.Calendar />
                </div>
                <div className="text-lg font-bold mb-2">No {activeSport.toUpperCase()} Games Today</div>
                <div className="text-sm text-gray-500 mb-6 max-w-[260px] mx-auto">Check back tomorrow or switch to another sport to find tonight's action.</div>
                
                {/* Retry Button */}
                <button
                  onClick={() => {
                    setLoading(true);
                    setLoadError(null);
                    api.getGames(activeSport).then(res => {
                      if (!res.error) setGames(res.games || []);
                      else setLoadError(res.error);
                      setLoading(false);
                    }).catch(err => {
                      setLoadError(err.message);
                      setLoading(false);
                    });
                  }}
                  className="px-6 py-2.5 bg-white/10 hover:bg-white/15 rounded-full text-sm font-medium transition-colors"
                >
                  Refresh
                </button>
                
                {loadError && (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mt-6 max-w-xs mx-auto">
                    {loadError.includes('fetch') || loadError.includes('network') 
                      ? '📡 Network error — check your connection' 
                      : `⚠️ ${loadError}`}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Challenge Tab */}
        {!loading && activeTab === 'challenge' && (
          <div className="animate-fadeIn">
            {challenge ? (
              <div className={`bg-gradient-to-b ${challenge.gameFinished ? 'from-emerald-500/10 to-emerald-500/[0.03] border-emerald-500/20' : challenge.gameStarted ? 'from-amber-500/10 to-amber-500/[0.03] border-amber-500/20' : 'from-orange-500/10 to-orange-500/[0.03] border-orange-500/20'} border rounded-3xl p-6 mb-6`}>
                <div className="flex justify-between items-center mb-5">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${challenge.gameFinished ? 'text-emerald-400' : challenge.gameStarted ? 'text-amber-400' : 'text-orange-400'}`}>
                    {challenge.gameFinished ? 'Final' : challenge.gameStarted ? 'Live' : 'Daily Challenge'}
                  </span>
                  <div className="flex items-center gap-2 px-3.5 py-2 bg-orange-500/15 border border-orange-500/25 rounded-2xl text-sm font-semibold">
                    <span className="text-orange-400"><Icons.Flame /></span>
                    <span>{userStats.streak} day streak</span>
                  </div>
                </div>
                
                <div className="text-2xl font-extrabold mb-1">{challenge.question}</div>
                <div className="text-sm text-gray-500 mb-4">{challenge.game?.awayTeam?.name} @ {challenge.game?.homeTeam?.name}</div>
                
                {/* Show score if game started */}
                {(challenge.gameStarted || challenge.gameFinished) && challenge.homeScore !== null && (
                  <div className="text-center py-3 mb-4 bg-white/5 rounded-xl">
                    <span className="text-3xl font-extrabold">
                      {challenge.awayScore} - {challenge.homeScore}
                    </span>
                    <span className={`ml-3 text-sm ${challenge.gameFinished ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {challenge.gameFinished ? 'Final' : 'Live'}
                    </span>
                  </div>
                )}

                {/* User's prediction status */}
                {userPrediction && (
                  <div className={`mb-4 p-3 rounded-xl text-center ${challenge.gameFinished ? (userPrediction === challenge.winner ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20') : 'bg-orange-500/10 border border-orange-500/20'}`}>
                    <span className={`text-sm ${challenge.gameFinished ? (userPrediction === challenge.winner ? 'text-emerald-400' : 'text-red-400') : 'text-orange-400'}`}>
                      {challenge.gameFinished ? 'Your Result: ' : 'Your Pick: '}
                      <strong>{userPrediction === 'home' ? challenge.game?.homeTeam?.name : challenge.game?.awayTeam?.name}</strong>
                      {challenge.gameFinished && (
                        <span className="ml-2">
                          {userPrediction === challenge.winner ? '- Correct' : '- Incorrect'}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                
                <div className="space-y-3 mb-6">
                  {challenge.options?.map(opt => {
                    const team = opt.value === 'away' ? challenge.game?.awayTeam : challenge.game?.homeTeam;
                    const isSelected = selectedPrediction === opt.value;
                    const isUserPick = userPrediction === opt.value;
                    const isWinner = challenge.winner === opt.value;
                    const isLoser = challenge.gameFinished && challenge.winner && challenge.winner !== opt.value;
                    const canVote = !userPrediction && !challenge.gameStarted && !challenge.gameFinished;
                    
                    // Determine user's result
                    const userWon = challenge.gameFinished && userPrediction && userPrediction === challenge.winner;
                    
                    return (
                      <AnimatedButton 
                        key={opt.value} 
                        onClick={() => canVote && handlePrediction(opt.value)} 
                        disabled={!canVote}
                        className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-colors 
                          ${challenge.gameFinished && isWinner ? 'border-emerald-500 bg-emerald-500/10' : ''}
                          ${challenge.gameFinished && isLoser ? 'border-red-500/30 bg-red-500/5 opacity-50' : ''}
                          ${!challenge.gameFinished && isUserPick ? 'border-orange-500 bg-orange-500/10' : ''}
                          ${!challenge.gameFinished && isSelected && !isUserPick ? 'border-orange-500 bg-orange-500/10' : ''}
                          ${!isWinner && !isLoser && !isUserPick && !isSelected ? 'border-white/5 bg-white/[0.03]' : ''}
                          ${!canVote ? 'cursor-not-allowed' : 'hover:bg-white/[0.05]'}`}
                      >
                        <div className="w-11 h-11 bg-white/10 rounded-xl flex items-center justify-center">
                          <img src={team?.logo_url} alt="" className="w-8 h-8 object-contain" />
                        </div>
                        <span className="flex-1 text-base font-semibold">{opt.label}</span>
                        
                        {/* Show appropriate indicator based on state */}
                        {challenge.gameFinished ? (
                          <div className="flex items-center gap-2">
                            {isUserPick && (
                              <span className={`text-xs ${userWon ? 'text-emerald-400' : 'text-red-400'}`}>
                                {userWon ? 'You won' : 'Your pick'}
                              </span>
                            )}
                            <div className={`px-3 py-1 rounded-lg text-sm font-bold ${isWinner ? 'bg-emerald-500 text-white' : 'bg-red-500/20 text-red-400'}`}>
                              {isWinner ? 'Winner' : 'Lost'}
                            </div>
                          </div>
                        ) : isUserPick ? (
                          <div className="px-3 py-1 bg-orange-500 text-white rounded-lg text-sm font-bold">
                            Your Pick
                          </div>
                        ) : (
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-white/10'}`}>
                            {isSelected && <Icons.Check />}
                          </div>
                        )}
                      </AnimatedButton>
                    );
                  })}
                </div>
                
                {/* Bottom action button */}
                {challenge.gameFinished ? (
                  <div className={`w-full py-4 rounded-2xl font-bold text-base text-center ${userPrediction === challenge.winner ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : userPrediction ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'}`}>
                    {userPrediction === challenge.winner ? 'Correct Prediction' : userPrediction ? 'Incorrect Prediction' : 'Game Complete'}
                  </div>
                ) : challenge.gameStarted ? (
                  <div className="w-full py-4 rounded-2xl font-bold text-base text-center bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    {userPrediction ? 'Your Pick is Locked In' : 'Voting Closed - Game In Progress'}
                  </div>
                ) : userPrediction ? (
                  <div className="w-full py-4 rounded-2xl font-bold text-base text-center bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    Prediction Locked
                  </div>
                ) : (
                  <AnimatedButton 
                    primary
                    onClick={submitPrediction} 
                    disabled={!selectedPrediction || submitting}
                    className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${!selectedPrediction ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-white text-black hover:shadow-lg hover:shadow-white/10'}`}
                  >
                    {submitting ? 'Locking In...' : 'Lock In Prediction'}
                  </AnimatedButton>
                )}
              </div>
            ) : (
              <div className="text-center py-16 animate-fadeIn">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-5 text-gray-500">
                  <Icons.Target />
                </div>
                <div className="text-lg font-bold mb-2">No Challenge Today</div>
                <div className="text-sm text-gray-500 max-w-[260px] mx-auto">Check back when games are scheduled to make your prediction.</div>
              </div>
            )}

            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">This Week's Leaders</div>
            <div className="space-y-2">
              {leaderboard.map((u, i) => (
                <div key={u.name} className={`flex items-center gap-3.5 p-4 rounded-2xl ${u.isUser ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/[0.02]'}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold ${i === 0 ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-black' : i === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-black' : i === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-700 text-white' : 'bg-white/5'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-xs text-gray-500">{u.streak} day streak</div>
                  </div>
                  <div className="text-lg font-extrabold">{u.points.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Profile Tab */}
        {!loading && activeTab === 'profile' && (
          <div className="animate-fadeIn">
            {/* Profile Header */}
            <div className="text-center py-8">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${settings.premium ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-black shadow-lg shadow-amber-500/30' : 'bg-white/10 border-2 border-white/10 text-gray-500'}`}>
                {settings.premium ? <Icons.Crown /> : <Icons.User />}
              </div>
              <div className="text-2xl font-extrabold mb-1">Guest</div>
              <div className="text-sm text-gray-500">{settings.premium ? 'Premium Member' : 'Free Account'}</div>
            </div>

            {/* Stats Cards */}
            <div className="flex gap-3 mb-8">
              {[
                ['Points', userStats.points, 'text-white'],
                ['Streak', userStats.streak, 'text-orange-400'],
                ['Accuracy', `${userStats.accuracy || 0}%`, 'text-emerald-400']
              ].map(([label, value, color]) => (
                <div key={label} className="flex-1 bg-white/[0.03] border border-white/5 rounded-2xl p-5 text-center">
                  <div className={`text-2xl font-extrabold mb-1 ${color}`}>{value}</div>
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
                </div>
              ))}
            </div>

            {/* Premium Upgrade */}
            {!settings.premium && (
              <AnimatedButton 
                primary 
                onClick={() => setShowPaywall(true)} 
                className="w-full py-4 bg-gradient-to-r from-yellow-400 to-amber-500 text-black rounded-2xl font-bold flex items-center justify-center gap-2.5 mb-8 hover:shadow-lg hover:shadow-amber-500/30 transition-shadow"
              >
                <Icons.Crown /> Upgrade to Premium
              </AnimatedButton>
            )}

            {/* App Info */}
            <div className="text-center py-6 border-t border-white/5">
              <div className="text-sm text-gray-500 mb-1">Gamenight v1.0</div>
              <div className="text-xs text-gray-600">Live data powered by ESPN</div>
            </div>
          </div>
        )}

        {/* Settings Tab - Clean & Organized */}
        {!loading && activeTab === 'settings' && (
          <div className="animate-fadeIn">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold mb-1">Settings</h1>
              <p className="text-sm text-gray-500">Customize your experience</p>
            </div>

            {/* Preferences Section */}
            <div className="mb-6">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Preferences</div>
              <div className="bg-white/[0.02] rounded-2xl border border-white/5 overflow-hidden">
                {[
                  ['bettingSignals', 'Betting Signals', 'Show odds and line movement', Icons.BarChart],
                ].map(([k, label, desc, Icon], idx, arr) => (
                  <div 
                    key={k} 
                    onClick={() => toggleSetting(k)} 
                    className={`flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors active:bg-white/[0.04] ${idx < arr.length - 1 ? 'border-b border-white/5' : ''}`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 bg-white/5 rounded-xl flex items-center justify-center text-gray-400"><Icon /></div>
                      <div>
                        <div className="text-[15px] text-white font-medium">{label}</div>
                        <div className="text-[13px] text-gray-500">{desc}</div>
                      </div>
                    </div>
                    <div 
                      className={`w-[52px] h-[32px] rounded-full relative transition-colors duration-200 ${settings[k] ? 'bg-orange-500' : 'bg-white/10'}`}
                    >
                      <div 
                        className="absolute top-[4px] w-[24px] h-[24px] bg-white rounded-full shadow-md transition-all duration-200" 
                        style={{ left: settings[k] ? '24px' : '4px' }} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notifications Section */}
            <div className="mb-6">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Notifications</div>
              <div className="bg-white/[0.02] rounded-2xl border border-white/5 overflow-hidden">
                {[
                  ['notifications', 'Push Notifications', 'Alerts when games start', Icons.Bell],
                  ['emailAlerts', 'Email Digest', 'Daily recommendations', Icons.Mail],
                ].map(([k, label, desc, Icon], idx, arr) => (
                  <div 
                    key={k} 
                    onClick={() => toggleSetting(k)} 
                    className={`flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors active:bg-white/[0.04] ${idx < arr.length - 1 ? 'border-b border-white/5' : ''}`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 bg-white/5 rounded-xl flex items-center justify-center text-gray-400"><Icon /></div>
                      <div>
                        <div className="text-[15px] text-white font-medium">{label}</div>
                        <div className="text-[13px] text-gray-500">{desc}</div>
                      </div>
                    </div>
                    <div 
                      className={`w-[52px] h-[32px] rounded-full relative transition-colors duration-200 ${settings[k] ? 'bg-orange-500' : 'bg-white/10'}`}
                    >
                      <div 
                        className="absolute top-[4px] w-[24px] h-[24px] bg-white rounded-full shadow-md transition-all duration-200" 
                        style={{ left: settings[k] ? '24px' : '4px' }} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Support Section */}
            <div className="mb-6">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Support</div>
              <div className="bg-white/[0.02] rounded-2xl border border-white/5 overflow-hidden">
                {[
                  ['Help Center', 'Get help with the app', Icons.HelpCircle, null],
                  ['Contact Us', 'support@gamenight.app', Icons.Mail, 'mailto:support@gamenight.app'],
                ].map(([label, desc, Icon, href], idx, arr) => (
                  <div 
                    key={label} 
                    onClick={() => href && window.open(href, '_blank')}
                    className={`flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors active:bg-white/[0.04] ${idx < arr.length - 1 ? 'border-b border-white/5' : ''}`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 bg-white/5 rounded-xl flex items-center justify-center text-gray-400"><Icon /></div>
                      <div>
                        <div className="text-[15px] text-white font-medium">{label}</div>
                        <div className="text-[13px] text-gray-500">{desc}</div>
                      </div>
                    </div>
                    <div className="text-gray-600"><Icons.ChevronRight /></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Purchases Section */}
            <div className="mb-6">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Purchases</div>
              <div className="bg-white/[0.02] rounded-2xl border border-white/5 overflow-hidden">
                <div 
                  onClick={() => showToastMsg('Purchases will be restorable once available.')}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors active:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-9 h-9 bg-white/5 rounded-xl flex items-center justify-center text-gray-400"><Icons.RefreshCw /></div>
                    <div>
                      <div className="text-[15px] text-white font-medium">Restore Purchases</div>
                      <div className="text-[13px] text-gray-500">Restore previous purchases</div>
                    </div>
                  </div>
                  <div className="text-gray-600"><Icons.ChevronRight /></div>
                </div>
              </div>
            </div>

            {/* Legal Section */}
            <div className="mb-6">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Legal</div>
              <div className="bg-white/[0.02] rounded-2xl border border-white/5 overflow-hidden">
                {[
                  ['Privacy Policy', Icons.Shield],
                  ['Terms of Service', Icons.FileText],
                ].map(([label, Icon], idx, arr) => (
                  <div 
                    key={label} 
                    className={`flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors active:bg-white/[0.04] ${idx < arr.length - 1 ? 'border-b border-white/5' : ''}`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 bg-white/5 rounded-xl flex items-center justify-center text-gray-400"><Icon /></div>
                      <div className="text-[15px] text-white font-medium">{label}</div>
                    </div>
                    <div className="text-gray-600"><Icons.ChevronRight /></div>
                  </div>
                ))}
              </div>
              
              {/* Betting Disclaimer in Settings */}
              <div className="mt-4 p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Entertainment Disclaimer</div>
                <div className="text-[13px] text-gray-400 leading-relaxed">
                  All game information, scores, and statistics are provided for entertainment purposes only. No real-money gambling or betting transactions occur within this app. Gamenight does not facilitate, encourage, or endorse gambling.
                </div>
              </div>
            </div>

            {/* App Info */}
            <div className="text-center py-6">
              <div className="text-sm text-gray-500 mb-1">Gamenight v1.0</div>
              <div className="text-xs text-gray-600">Live data powered by ESPN</div>
            </div>
          </div>
        )}
      </main>

      {/* Tab Bar - Safe area aware */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-white/5 z-50" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 20px), 20px)' }}>
        <div className="flex justify-center gap-2 px-4 pt-3 max-w-md mx-auto">
          {[
            ['tonight', 'Tonight', Icons.Home],
            ['challenge', 'Challenge', Icons.Target],
            ['profile', 'Profile', Icons.User]
          ].map(([tab, label, Icon]) => (
            <AnimatedButton 
              key={tab} 
              onClick={() => { setActiveTab(tab); window.scrollTo(0, 0); }} 
              className={`flex flex-col items-center gap-1 px-6 py-2.5 rounded-2xl transition-all min-w-[80px] ${
                activeTab === tab 
                  ? 'text-white bg-white/10' 
                  : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              <Icon />
              <span className="text-[11px] font-semibold">{label}</span>
            </AnimatedButton>
          ))}
        </div>
      </nav>

      {/* Team Modal - ESPN-Style Design */}
      {selectedTeam && !selectedPlayer && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col"
          style={{ backgroundColor: '#0a0a0f' }} 
          onClick={() => { setSelectedTeam(null); setTeamDetails(null); setTeamError(null); }}
        >
          <div 
            className="flex flex-col h-full w-full max-w-md mx-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Top Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <AnimatedButton 
                onClick={() => { setSelectedTeam(null); setTeamDetails(null); setTeamError(null); }} 
                className="w-10 h-10 flex items-center justify-center text-white"
              >
                <Icons.ChevronLeft />
              </AnimatedButton>
              <div className="text-center">
                <div className="text-xs text-gray-500 uppercase tracking-wider">{activeSport.toUpperCase()}</div>
                <div className="text-base font-semibold">Team</div>
              </div>
              <div className="w-10" />
            </div>

            {/* Team Identity Header */}
            <div className="px-5 py-4">
              <div className="flex items-start gap-4">
                {/* Logo */}
                <div className="w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <img src={selectedTeam.logo_url} alt="" className="w-16 h-16 object-contain" />
                </div>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-bold mb-2">{selectedTeam.name}</h1>
                  
                  {/* Record & Standing */}
                  {!teamLoading && teamDetails && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{teamDetails.record || selectedTeam.record}</span>
                      {teamDetails.standing && (
                        <>
                          <span className="text-gray-600">·</span>
                          <span className="text-gray-400">{teamDetails.standing}</span>
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Status Badge */}
                  {!teamLoading && teamDetails && (
                    <div className="mt-2">
                      {teamDetails.gameStatus === 'live' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/20 text-red-400 rounded-md text-xs font-medium">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                          LIVE
                        </span>
                      ) : teamDetails.gameStatus === 'today' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 text-emerald-400 rounded-md text-xs font-medium">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                          Playing Tonight
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-white/10">
              <button 
                onClick={() => setTeamTab('stats')}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${teamTab === 'stats' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500'}`}
              >
                Stats
              </button>
              <button 
                onClick={() => setTeamTab('roster')}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${teamTab === 'roster' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500'}`}
              >
                Roster
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Loading State */}
              {teamLoading && (
                <div className="p-5 space-y-4">
                  {/* Stats skeleton */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="skeleton h-24 rounded-2xl" />
                    <div className="skeleton h-24 rounded-2xl" />
                  </div>
                  <div className="skeleton h-32 rounded-2xl" />
                  <div className="skeleton h-20 rounded-2xl" />
                  <div className="skeleton h-48 rounded-2xl" />
                </div>
              )}

              {/* Error State */}
              {!teamLoading && teamError && (
                <div className="text-center py-16 px-5 animate-fadeIn">
                  <div className="w-14 h-14 mx-auto mb-4 bg-white/5 rounded-full flex items-center justify-center text-gray-500">
                    <Icons.AlertCircle />
                  </div>
                  <div className="text-lg font-semibold mb-2">Couldn't Load Team</div>
                  <div className="text-sm text-gray-500 mb-6">Something went wrong. Please try again.</div>
                  <AnimatedButton 
                    onClick={() => {
                      setTeamLoading(true);
                      setTeamError(null);
                      api.getTeam(selectedTeam.abbreviation || selectedTeam.id, activeSport)
                        .then(res => {
                          if (res.error || !res.team) setTeamError(res.error || 'Failed');
                          else setTeamDetails(res.team);
                          setTeamLoading(false);
                        })
                        .catch(err => { setTeamError(err.message); setTeamLoading(false); });
                    }}
                    className="px-6 py-2.5 bg-white/10 hover:bg-white/15 rounded-full text-sm font-semibold transition-colors"
                  >
                    Try Again
                  </AnimatedButton>
                </div>
              )}

              {/* Team Content */}
              {!teamLoading && !teamError && teamDetails && (
                <div className="p-5">
                  {/* Stats Tab Content */}
                  {teamTab === 'stats' && (
                    <>
                      {/* Record Header */}
                      <div className="flex items-center justify-between mb-5 pb-4 border-b border-white/5">
                        <div>
                          <div className="text-2xl font-bold">{teamDetails.wins}-{teamDetails.losses}</div>
                          <div className="text-xs text-gray-500">{teamDetails.standing}</div>
                        </div>
                      </div>
                      
                      {/* Last 5 Games */}
                      {teamDetails.lastFiveGames?.length > 0 && (
                        <div className="mb-6">
                          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Last 5 Games</div>
                          <div className="flex gap-2">
                            {teamDetails.lastFiveGames.map((game, i) => (
                              <div key={i} className={`flex-1 rounded-xl p-2 text-center ${game.won ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                <div className={`text-xs font-bold mb-1 ${game.won ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {game.won ? 'W' : 'L'}
                                </div>
                                <div className="text-[10px] text-gray-400 truncate">
                                  {game.isHome ? 'vs' : '@'} {game.opponent}
                                </div>
                                <div className="text-xs font-semibold mt-0.5">{game.score}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Top 2 Rankings */}
                      {teamDetails.rankings?.strengths?.length > 0 ? (
                        <div className="mb-6">
                          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">League Leaders</div>
                          <div className="space-y-3">
                            {teamDetails.rankings.strengths.slice(0, 2).map((stat, i) => (
                              <div key={i} className="bg-white/[0.03] rounded-xl p-4 flex items-center justify-between">
                                <div>
                                  <div className="text-2xl font-bold text-blue-400">{stat.value}</div>
                                  <div className="text-xs text-gray-500 uppercase mt-1">{stat.shortName}</div>
                                </div>
                                <div className={`text-lg font-bold px-3 py-1.5 rounded-lg ${
                                  stat.rank <= 3 ? 'bg-emerald-500/20 text-emerald-400' :
                                  stat.rank <= 10 ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-white/10 text-gray-400'
                                }`}>
                                  {stat.rank}{stat.rank === 1 ? 'st' : stat.rank === 2 ? 'nd' : stat.rank === 3 ? 'rd' : 'th'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        /* Fallback to basic stats if no rankings */
                        <div className="mb-6">
                          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Season Stats</div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white/[0.03] rounded-xl p-4 text-center">
                              <div className="text-2xl font-bold text-blue-400">
                                {teamDetails.ppg || '—'}
                              </div>
                              <div className="text-xs text-gray-500 uppercase mt-1">PPG</div>
                            </div>
                            <div className="bg-white/[0.03] rounded-xl p-4 text-center">
                              <div className="text-2xl font-bold text-blue-400">
                                {teamDetails.oppg || '—'}
                              </div>
                              <div className="text-xs text-gray-500 uppercase mt-1">OPP PPG</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Injuries Section */}
                      <div className="mb-6">
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`w-2 h-2 rounded-full ${teamDetails.injuries?.length > 0 ? 'bg-red-500' : 'bg-emerald-500'}`} />
                          <span className={`text-xs uppercase tracking-wider font-semibold ${teamDetails.injuries?.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {teamDetails.injuries?.length > 0 ? 'Injury Report' : 'Injury Report'}
                          </span>
                        </div>
                        {teamDetails.injuries && teamDetails.injuries.length > 0 ? (
                          <div className="bg-white/[0.03] rounded-xl overflow-hidden">
                            {teamDetails.injuries.slice(0, 4).map((inj, i) => (
                              <div key={i} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-white/5' : ''}`}>
                                <div>
                                  <div className="text-sm font-medium">{inj.name}</div>
                                  <div className="text-xs text-gray-500">{inj.position}{inj.type ? ` · ${inj.type}` : ''}</div>
                                </div>
                                <span className={`text-xs font-semibold px-2.5 py-1 rounded ${
                                  inj.status === 'Out' ? 'bg-red-500/20 text-red-400' : 
                                  inj.status === 'Doubtful' ? 'bg-orange-500/20 text-orange-400' :
                                  'bg-yellow-500/20 text-yellow-400'
                                }`}>{inj.status}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="bg-white/[0.03] rounded-xl px-4 py-3 text-sm text-emerald-400">
                            No injuries reported
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Roster Tab Content */}
                  {teamTab === 'roster' && (
                    <div className="animate-fadeIn">
                      {/* Loading State */}
                      {teamLoading && (
                        <div className="space-y-2">
                          {[1,2,3,4,5,6].map(i => (
                            <div key={i} className="flex items-center gap-3 p-3">
                              <div className="skeleton w-10 h-10 rounded-full" />
                              <div className="flex-1">
                                <div className="skeleton w-32 h-4 mb-2 rounded" />
                                <div className="skeleton w-20 h-3 rounded" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Empty State */}
                      {!teamLoading && (!teamDetails.roster || teamDetails.roster.length === 0) && (
                        <div className="text-center py-12 bg-white/[0.02] rounded-2xl border border-white/5">
                          <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-500">
                            <Icons.User />
                          </div>
                          <div className="text-sm text-gray-400 font-medium">Roster Unavailable</div>
                          <div className="text-xs text-gray-600 mt-1">Check back later</div>
                        </div>
                      )}
                      
                      {!teamLoading && teamDetails.roster && teamDetails.roster.length > 0 && (
                        <>
                          {/* ============ NBA ROSTER ============ */}
                          {activeSport === 'nba' && (() => {
                            // Guard: Check for valid roster array
                            const roster = teamDetails.roster || [];
                            if (roster.length === 0) {
                              return (
                                <div className="text-center py-8 bg-white/[0.02] rounded-2xl border border-white/5">
                                  <div className="text-sm text-gray-400">No roster data available</div>
                                </div>
                              );
                            }
                            
                            // Get players ESPN marked as starters
                            const espnStarters = roster.filter(p => p.isStarter);
                            const nonStarters = roster.filter(p => !p.isStarter);
                            
                            // Position priority for filling gaps
                            const positionPriority = ['PG', 'SG', 'SF', 'PF', 'C'];
                            const fallbackPositions = ['G', 'F', 'G-F', 'F-G', 'F-C', 'C-F'];
                            
                            // Build starting 5: use ESPN starters first, then fill gaps
                            let displayStarters = [...espnStarters];
                            
                            // If we have less than 5 starters, fill remaining slots
                            if (displayStarters.length < 5) {
                              // Track which positions we already have
                              const filledPositions = displayStarters.map(p => p.position);
                              
                              // First pass: fill by missing core positions
                              positionPriority.forEach(pos => {
                                if (displayStarters.length >= 5) return;
                                if (filledPositions.some(fp => fp === pos)) return;
                                
                                const candidate = nonStarters.find(p => 
                                  p.position === pos && !displayStarters.includes(p)
                                );
                                if (candidate) {
                                  candidate._inferred = true;
                                  displayStarters.push(candidate);
                                  filledPositions.push(pos);
                                }
                              });
                              
                              // Second pass: fill by flexible positions (G, F, etc.)
                              fallbackPositions.forEach(pos => {
                                if (displayStarters.length >= 5) return;
                                
                                const candidate = nonStarters.find(p => 
                                  (p.position === pos || p.position?.includes(pos.charAt(0))) && 
                                  !displayStarters.includes(p)
                                );
                                if (candidate) {
                                  candidate._inferred = true;
                                  displayStarters.push(candidate);
                                }
                              });
                              
                              // Third pass: if still short, just take top remaining by experience
                              if (displayStarters.length < 5) {
                                const remaining = nonStarters
                                  .filter(p => !displayStarters.includes(p))
                                  .sort((a, b) => (b.experience || 0) - (a.experience || 0));
                                
                                while (displayStarters.length < 5 && remaining.length > 0) {
                                  const next = remaining.shift();
                                  next._inferred = true;
                                  displayStarters.push(next);
                                }
                              }
                            }
                            
                            // Sort starters by position order for display
                            const posOrder = { 'PG': 1, 'G': 2, 'SG': 3, 'SF': 4, 'F': 5, 'PF': 6, 'C': 7 };
                            displayStarters.sort((a, b) => 
                              (posOrder[a.position] || 99) - (posOrder[b.position] || 99)
                            );
                            
                            // Bench is everyone not in displayStarters
                            const displayBench = roster.filter(p => !displayStarters.includes(p));
                            
                            // Determine label
                            const hasFullESPNStarters = espnStarters.length >= 5;
                            const hasPartialESPNStarters = espnStarters.length > 0 && espnStarters.length < 5;
                            const hasNoESPNStarters = espnStarters.length === 0;
                            
                            return (
                              <>
                                {/* Starting 5 */}
                                <div className="mb-6">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Starting 5</span>
                                    {hasPartialESPNStarters && (
                                      <span className="text-[10px] text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">Partial Lineup</span>
                                    )}
                                    {hasNoESPNStarters && (
                                      <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">Projected</span>
                                    )}
                                  </div>
                                  
                                  {displayStarters.length === 0 ? (
                                    <div className="text-center py-6 bg-white/[0.02] rounded-xl border border-white/5">
                                      <div className="text-sm text-gray-500">Starting lineup unavailable</div>
                                    </div>
                                  ) : (
                                    <>
                                      {displayStarters.length < 5 && (
                                        <div className="text-xs text-gray-500 mb-2 italic">
                                          Starters not fully available — showing best estimate ({displayStarters.length}/5)
                                        </div>
                                      )}
                                      
                                      <div className="space-y-1">
                                        {displayStarters.map((player, i) => (
                                          <RosterRow 
                                            key={player.id || i} 
                                            player={player} 
                                            onClick={() => setSelectedPlayer(player)}
                                            isStarter={true}
                                            sport="nba"
                                            isInferred={player._inferred}
                                          />
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                                
                                {/* Bench */}
                                {displayBench.length > 0 && (
                                  <div>
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bench</span>
                                      <span className="text-[10px] text-gray-600">{displayBench.length} players</span>
                                    </div>
                                    <div className="space-y-1">
                                      {displayBench.map((player, i) => (
                                        <RosterRow 
                                          key={player.id || i} 
                                          player={player} 
                                          onClick={() => setSelectedPlayer(player)}
                                          isStarter={false}
                                          sport="nba"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          
                          {/* ============ NFL ROSTER ============ */}
                          {/* KEY PLAYERS ONLY: One starter per position group, not all backups */}
                          {activeSport === 'nfl' && (() => {
                            // Guard: Check for valid roster array
                            const roster = teamDetails.roster || [];
                            if (roster.length === 0) {
                              return (
                                <div className="text-center py-8 bg-white/[0.02] rounded-2xl border border-white/5">
                                  <div className="text-sm text-gray-400">No roster data available</div>
                                  <div className="text-xs text-gray-600 mt-1">Check back later for updates</div>
                                </div>
                              );
                            }
                            
                            // Check if player is injured/out
                            const isOut = (player) => {
                              if (!player) return false;
                              const status = player.status?.toLowerCase() || '';
                              return status === 'out' || status === 'ir' || status === 'injured reserve' || 
                                     status === 'pup' || status === 'nfi' || status === 'suspended';
                            };
                            
                            // Position groups for NFL key players (we want ONE starter from each)
                            const positionGroups = {
                              'QB': ['QB'],
                              'RB': ['RB', 'FB'],
                              'WR1': ['WR'],
                              'WR2': ['WR'],  // We'll pick 2 WRs
                              'TE': ['TE'],
                              'LT': ['LT', 'OT', 'T'],
                              'C': ['C'],
                              'DE1': ['DE', 'EDGE', 'OLB'],
                              'DE2': ['DE', 'EDGE', 'OLB'],
                              'DT': ['DT', 'NT', 'DL'],
                              'LB': ['LB', 'ILB', 'MLB'],
                              'CB1': ['CB', 'DB'],
                              'CB2': ['CB', 'DB'],
                              'S': ['S', 'FS', 'SS']
                            };
                            
                            // The roster is sorted by depth chart - first player at each position is the starter
                            const activePlayers = roster.filter(p => p && !isOut(p));
                            const outPlayers = roster.filter(p => p && isOut(p));
                            
                            // Pick KEY players: first (starter) from each position group
                            const keyPlayers = [];
                            const usedIds = new Set();
                            const positionCounts = {};
                            
                            // Go through roster in depth chart order and pick starters
                            activePlayers.forEach(player => {
                              if (!player || !player.position) return;
                              const pos = player.position;
                              
                              // Track how many we've picked from each position
                              positionCounts[pos] = (positionCounts[pos] || 0);
                              
                              // Determine if this player should be a "key player"
                              let isKey = false;
                              
                              // QB: Only the starter (first one)
                              if (pos === 'QB' && positionCounts['QB'] === 0) {
                                isKey = true;
                              }
                              // RB: Top 1
                              else if ((pos === 'RB' || pos === 'FB') && (positionCounts['RB'] || 0) + (positionCounts['FB'] || 0) < 1) {
                                isKey = true;
                              }
                              // WR: Top 2
                              else if (pos === 'WR' && positionCounts['WR'] < 2) {
                                isKey = true;
                              }
                              // TE: Top 1
                              else if (pos === 'TE' && positionCounts['TE'] < 1) {
                                isKey = true;
                              }
                              // OL: Top 2 (LT and C typically)
                              else if (['LT', 'RT', 'OT', 'T', 'C', 'G', 'LG', 'RG', 'OL'].includes(pos) && 
                                       keyPlayers.filter(p => ['LT', 'RT', 'OT', 'T', 'C', 'G', 'LG', 'RG', 'OL'].includes(p.position)).length < 2) {
                                isKey = true;
                              }
                              // DE/EDGE: Top 2
                              else if (['DE', 'EDGE', 'OLB'].includes(pos) && 
                                       keyPlayers.filter(p => ['DE', 'EDGE', 'OLB'].includes(p.position)).length < 2) {
                                isKey = true;
                              }
                              // DT/NT: Top 1
                              else if (['DT', 'NT', 'DL'].includes(pos) && 
                                       keyPlayers.filter(p => ['DT', 'NT', 'DL'].includes(p.position)).length < 1) {
                                isKey = true;
                              }
                              // LB: Top 1
                              else if (['LB', 'ILB', 'MLB'].includes(pos) && 
                                       keyPlayers.filter(p => ['LB', 'ILB', 'MLB'].includes(p.position)).length < 1) {
                                isKey = true;
                              }
                              // CB: Top 2
                              else if (['CB', 'DB'].includes(pos) && 
                                       keyPlayers.filter(p => ['CB', 'DB'].includes(p.position)).length < 2) {
                                isKey = true;
                              }
                              // Safety: Top 1
                              else if (['S', 'FS', 'SS'].includes(pos) && 
                                       keyPlayers.filter(p => ['S', 'FS', 'SS'].includes(p.position)).length < 1) {
                                isKey = true;
                              }
                              
                              if (isKey && player.id && !usedIds.has(player.id)) {
                                keyPlayers.push({ ...player, _isPrimaryQB: pos === 'QB' && keyPlayers.filter(p => p.position === 'QB').length === 0 });
                                usedIds.add(player.id);
                                positionCounts[pos] = (positionCounts[pos] || 0) + 1;
                              }
                            });
                            
                            // Remaining players (depth)
                            const depthPlayers = activePlayers.filter(p => p && p.id && !usedIds.has(p.id));
                            
                            // Fallback: If key player selection failed, show all active players grouped by position
                            const keyPlayersFailed = keyPlayers.length === 0 && activePlayers.length > 0;
                            
                            return (
                              <>
                                {/* Fallback: Show all players if key player selection failed */}
                                {keyPlayersFailed ? (
                                  <div className="mb-6">
                                    <div className="flex items-center gap-2 mb-3">
                                      <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Full Roster</span>
                                      <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">{activePlayers.length} players</span>
                                    </div>
                                    <div className="text-xs text-gray-500 mb-3 italic">Position data unavailable — showing all players</div>
                                    <div className="space-y-1">
                                      {activePlayers.map((player, i) => (
                                        <RosterRow 
                                          key={player.id || i} 
                                          player={player} 
                                          onClick={() => setSelectedPlayer(player)}
                                          isStarter={false}
                                          sport="nfl"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Key Players - Starters Only */}
                                    <div className="mb-6">
                                      <div className="flex items-center gap-2 mb-3">
                                        <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Key Players</span>
                                        <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">Starters</span>
                                      </div>
                                      {keyPlayers.length === 0 ? (
                                        <div className="text-center py-6 bg-white/[0.02] rounded-xl border border-white/5">
                                          <div className="text-sm text-gray-500">Key players unavailable</div>
                                        </div>
                                      ) : (
                                        <div className="space-y-1">
                                          {keyPlayers.map((player, i) => (
                                            <RosterRow 
                                              key={player.id || i} 
                                              player={player} 
                                              onClick={() => setSelectedPlayer(player)}
                                              isStarter={true}
                                              sport="nfl"
                                            />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Depth / Backups - Collapsed */}
                                    {depthPlayers.length > 0 && (
                                      <div className="mb-6 border-t border-gray-800 pt-4">
                                        <button
                                          className="w-full flex items-center justify-between py-2 text-left"
                                          onClick={() => setShowNFLDepth(!showNFLDepth)}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Depth / Rotation</span>
                                            <span className="text-[10px] text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">{depthPlayers.length}</span>
                                          </div>
                                          <svg 
                                            className={`w-4 h-4 text-gray-500 transition-transform ${showNFLDepth ? 'rotate-180' : ''}`} 
                                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                          >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                        
                                        {showNFLDepth && (
                                          <div className="mt-3 space-y-1 opacity-75">
                                            {depthPlayers.map((player, i) => (
                                              <RosterRow 
                                                key={player.id || i} 
                                                player={player} 
                                                onClick={() => setSelectedPlayer(player)}
                                                isStarter={false}
                                                sport="nfl"
                                              />
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                                
                                {/* Injured / Out - Collapsed */}
                                {outPlayers.length > 0 && (
                                  <div className="border-t border-gray-800 pt-4">
                                    <button
                                      className="w-full flex items-center justify-between py-2 text-left"
                                      onClick={() => setShowNFLInjured(!showNFLInjured)}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-red-500" />
                                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Injured / Out</span>
                                        <span className="text-[10px] text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">{outPlayers.length}</span>
                                      </div>
                                      <svg 
                                        className={`w-4 h-4 text-gray-500 transition-transform ${showNFLInjured ? 'rotate-180' : ''}`} 
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    
                                    {showNFLInjured && (
                                      <div className="mt-3 space-y-1 opacity-75">
                                        {outPlayers.map((player, i) => (
                                          <RosterRow 
                                            key={player.id || i} 
                                            player={player} 
                                            onClick={() => setSelectedPlayer(player)}
                                            isStarter={false}
                                            sport="nfl"
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          
                          {/* ============ MLB ROSTER ============ */}
                          {/* Game-Day Focused Hierarchy: Starting Pitcher → Batting Lineup → Other Players */}
                          {activeSport === 'mlb' && (() => {
                            // Guard: Check for valid roster array
                            const roster = teamDetails.roster || [];
                            if (roster.length === 0) {
                              return (
                                <div className="text-center py-8 bg-white/[0.02] rounded-2xl border border-white/5">
                                  <div className="text-sm text-gray-400">No roster data available</div>
                                  <div className="text-xs text-gray-600 mt-1">Check back later for updates</div>
                                </div>
                              );
                            }
                            
                            // Separate all players into categories with null checks
                            const allPitchers = roster.filter(p => p && ['SP', 'RP', 'CL', 'P'].includes(p.position));
                            const startingPitchers = allPitchers.filter(p => p && p.position === 'SP');
                            const bullpen = allPitchers.filter(p => p && ['RP', 'CL', 'P'].includes(p.position));
                            const positionPlayers = roster.filter(p => p && !['SP', 'RP', 'CL', 'P'].includes(p.position));
                            
                            // Find today's starting pitcher from probableStarter data
                            const todayStarter = teamDetails.probableStarter;
                            const todayGame = teamDetails.todayGame;
                            
                            // Match today's starter to roster for full data
                            let confirmedStarter = null;
                            if (todayStarter?.id) {
                              confirmedStarter = startingPitchers.find(p => String(p.id) === String(todayStarter.id));
                              if (confirmedStarter) {
                                confirmedStarter = { ...confirmedStarter, ...todayStarter, isStartingToday: true };
                              }
                            }
                            
                            // Other SPs (not starting today)
                            const otherStarters = startingPitchers.filter(p => 
                              !confirmedStarter || String(p.id) !== String(confirmedStarter.id)
                            );
                            
                            // Typical batting order positions (for lineup estimation when no live data)
                            const battingPositionOrder = { 
                              'CF': 1, 'LF': 2, 'RF': 3, 'SS': 4, '1B': 5, 
                              '3B': 6, 'DH': 7, 'C': 8, '2B': 9, 
                              'OF': 10, 'IF': 11, 'UT': 12 
                            };
                            
                            // Sort position players by batting relevance, then experience
                            const sortedPositionPlayers = [...positionPlayers].sort((a, b) => {
                              const orderA = battingPositionOrder[a.position] || 99;
                              const orderB = battingPositionOrder[b.position] || 99;
                              if (orderA !== orderB) return orderA - orderB;
                              return (b.experience || 0) - (a.experience || 0);
                            });
                            
                            // Probable lineup (first 9 position players)
                            const probableLineup = sortedPositionPlayers.slice(0, 9);
                            const benchPlayers = sortedPositionPlayers.slice(9);
                            
                            // Verification log
                            console.log('[MLB Roster Verification]', {
                              startingPitcher: confirmedStarter?.name || 'TBD',
                              lineupCount: probableLineup.length,
                              benchCount: benchPlayers.length,
                              bullpenCount: bullpen.length,
                              otherStartersCount: otherStarters.length,
                              totalRoster: teamDetails.roster.length,
                              allAccountedFor: (confirmedStarter ? 1 : 0) + otherStarters.length + probableLineup.length + benchPlayers.length + bullpen.length
                            });
                            
                            return (
                              <>
                                {/* ======= SECTION 1: STARTING PITCHER (ALWAYS FIRST) ======= */}
                                <div className="mb-6">
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                    <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Starting Pitcher</span>
                                    {todayGame && (
                                      <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full ml-auto">
                                        {todayGame.isHome ? 'vs' : '@'} {todayGame.opponentAbbr || todayGame.opponent}
                                      </span>
                                    )}
                                  </div>
                                  
                                  {confirmedStarter ? (
                                    <div 
                                      className="bg-gradient-to-r from-red-500/10 to-transparent border border-red-500/20 rounded-xl p-4 cursor-pointer hover:bg-red-500/15 transition-colors"
                                      onClick={() => setSelectedPlayer(confirmedStarter)}
                                    >
                                      <div className="flex items-center gap-4">
                                        <div className="relative">
                                          {confirmedStarter.headshot ? (
                                            <img src={confirmedStarter.headshot} alt="" className="w-14 h-14 rounded-full object-cover bg-gray-800" />
                                          ) : (
                                            <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center text-gray-500 text-lg font-bold">
                                              {confirmedStarter.name?.charAt(0)}
                                            </div>
                                          )}
                                          <div className="absolute -bottom-1 -right-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                            SP
                                          </div>
                                        </div>
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2">
                                            <span className="font-semibold text-white">{confirmedStarter.name}</span>
                                            {confirmedStarter.throws && (
                                              <span className="text-[10px] text-gray-400 bg-white/10 px-1.5 py-0.5 rounded">
                                                {confirmedStarter.throws === 'L' ? 'LHP' : 'RHP'}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs text-gray-400 mt-1">
                                            {todayGame ? (
                                              <span className="text-green-400 font-medium">Starting Today</span>
                                            ) : (
                                              <span>#{confirmedStarter.jersey}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                          </svg>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                                      <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-full bg-gray-700/50 flex items-center justify-center">
                                          <span className="text-2xl text-gray-500">?</span>
                                        </div>
                                        <div>
                                          <div className="font-semibold text-gray-400">Starting Pitcher TBD</div>
                                          <div className="text-xs text-gray-500 mt-1">
                                            {todayGame ? 'Not yet announced' : 'No game scheduled today'}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                
                                {/* ======= SECTION 2: BATTING LINEUP ======= */}
                                <div className="mb-6">
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Batting Lineup</span>
                                    <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">Projected</span>
                                  </div>
                                  
                                  {probableLineup.length === 0 ? (
                                    <div className="text-center py-6 bg-white/[0.02] rounded-xl border border-white/5">
                                      <div className="text-sm text-gray-500">Lineup data unavailable</div>
                                      <div className="text-xs text-gray-600 mt-1">Check back closer to game time</div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="space-y-1">
                                        {probableLineup.map((player, i) => (
                                          <div
                                            key={player.id || i}
                                            className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group"
                                            onClick={() => setSelectedPlayer(player)}
                                          >
                                            {/* Batting Order Number */}
                                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                              <span className="text-xs font-bold text-emerald-400">{i + 1}</span>
                                            </div>
                                            
                                            {/* Player Photo */}
                                            {player.headshot ? (
                                              <img src={player.headshot} alt="" className="w-10 h-10 rounded-full object-cover bg-gray-800" />
                                            ) : (
                                              <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-500 text-sm font-bold">
                                                {player.name?.charAt(0) || '?'}
                                              </div>
                                            )}
                                            
                                            {/* Player Info */}
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium text-white truncate">{player.name || 'Unknown'}</div>
                                              <div className="text-xs text-gray-500">
                                                {player.position || 'POS'} {player.jersey && `#${player.jersey}`}
                                              </div>
                                            </div>
                                            
                                            {/* Arrow */}
                                            <svg className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                          </div>
                                        ))}
                                      </div>
                                      
                                      {probableLineup.length < 9 && probableLineup.length > 0 && (
                                        <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                          <div className="text-xs text-yellow-400">
                                            ⚠️ Lineup incomplete ({probableLineup.length}/9 positions filled)
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                                
                                {/* ======= SECTION 3: OTHER PLAYERS (Collapsed by Default) ======= */}
                                <div className="border-t border-gray-800 pt-4">
                                  <button
                                    className="w-full flex items-center justify-between py-2 text-left"
                                    onClick={() => setShowMLBOtherPlayers(!showMLBOtherPlayers)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full bg-gray-500"></div>
                                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Other Players</span>
                                      <span className="text-[10px] text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">
                                        {otherStarters.length + benchPlayers.length + bullpen.length}
                                      </span>
                                    </div>
                                    <svg 
                                      className={`w-4 h-4 text-gray-500 transition-transform ${showMLBOtherPlayers ? 'rotate-180' : ''}`} 
                                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>
                                  
                                  {showMLBOtherPlayers && (
                                    <div className="mt-3 space-y-4 opacity-75">
                                      {/* Starting Rotation (others) */}
                                      {otherStarters.length > 0 && (
                                        <div>
                                          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Starting Rotation</div>
                                          <div className="space-y-1">
                                            {otherStarters.map((player, i) => (
                                              <RosterRow 
                                                key={player.id || i} 
                                                player={player} 
                                                onClick={() => setSelectedPlayer(player)}
                                                isStarter={false}
                                                sport="mlb"
                                                showPitcherHand={true}
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      
                                      {/* Bullpen */}
                                      {bullpen.length > 0 && (
                                        <div>
                                          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Bullpen ({bullpen.length})</div>
                                          <div className="space-y-1">
                                            {bullpen.map((player, i) => (
                                              <RosterRow 
                                                key={player.id || i} 
                                                player={player} 
                                                onClick={() => setSelectedPlayer(player)}
                                                isStarter={false}
                                                sport="mlb"
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      
                                      {/* Bench */}
                                      {benchPlayers.length > 0 && (
                                        <div>
                                          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Bench ({benchPlayers.length})</div>
                                          <div className="space-y-1">
                                            {benchPlayers.map((player, i) => (
                                              <RosterRow 
                                                key={player.id || i} 
                                                player={player} 
                                                onClick={() => setSelectedPlayer(player)}
                                                isStarter={false}
                                                sport="mlb"
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player Modal - Premium Design */}
      {selectedPlayer && (
        <div 
          className="fixed inset-0 z-[110] flex items-end justify-center"
          style={{ backgroundColor: '#000' }} 
          onClick={() => { setSelectedPlayer(null); setPlayerDetails(null); }}
        >
          <div 
            className="bg-[#0d0d12] w-full max-w-md max-h-[85vh] rounded-t-[32px] overflow-hidden flex flex-col border-t border-white/10"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent" />
              <div className="relative flex items-center justify-between px-5 pt-4 pb-3">
                <AnimatedButton 
                  onClick={() => { setSelectedPlayer(null); setPlayerDetails(null); }} 
                  className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-gray-400 hover:bg-white/15 transition-colors"
                >
                  <Icons.ChevronLeft />
                </AnimatedButton>
                <span className="text-sm font-medium text-gray-400">Player Profile</span>
                <div className="w-8" />
              </div>
            </div>
            
            <div className="px-5 pb-10 overflow-y-auto flex-1">
              {/* Player Identity */}
              <div className="text-center pt-2 pb-6">
                {(selectedPlayer.headshot || playerDetails?.headshot) ? (
                  <img 
                    src={playerDetails?.headshot || selectedPlayer.headshot} 
                    alt="" 
                    className="w-28 h-28 mx-auto mb-4 rounded-full object-cover bg-gradient-to-br from-white/10 to-white/5 ring-4 ring-white/10 shadow-xl"
                  />
                ) : (
                  <div className="w-28 h-28 mx-auto mb-4 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-3xl font-bold text-gray-500 ring-4 ring-white/10 shadow-xl">
                    {selectedPlayer.jersey || '?'}
                  </div>
                )}
                <h1 className="text-2xl font-bold tracking-tight">{selectedPlayer.name}</h1>
                <p className="text-gray-500 mt-1">
                  {selectedPlayer.position}
                  {selectedPlayer.jersey && ` · #${selectedPlayer.jersey}`}
                </p>
                
                {/* Team Badge */}
                <div className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 bg-white/5 rounded-full">
                  {selectedTeam?.logo_url && <img src={selectedTeam.logo_url} alt="" className="w-4 h-4" />}
                  <span className="text-sm text-gray-400">{selectedTeam?.name}</span>
                </div>

                {/* Injury Status Badge */}
                {(selectedPlayer.status || playerDetails?.status) && 
                 (selectedPlayer.status !== 'active' && selectedPlayer.status !== 'Active') && (
                  <div className="mt-4">
                    <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border ${
                      (playerDetails?.status || selectedPlayer.status) === 'Out' 
                        ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                        : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        (playerDetails?.status || selectedPlayer.status) === 'Out' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      {playerDetails?.status || selectedPlayer.status}
                      {(playerDetails?.injuryType || selectedPlayer.injuryType) && (
                        <span className="text-gray-500 font-normal">· {playerDetails?.injuryType || selectedPlayer.injuryType}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Loading */}
              {playerLoading && (
                <div className="space-y-3">
                  <div className="h-24 bg-white/[0.03] rounded-2xl animate-pulse" />
                  <div className="h-12 bg-white/[0.03] rounded-2xl animate-pulse" />
                </div>
              )}

              {/* Stats Card */}
              {!playerLoading && playerDetails?.stats && Object.keys(playerDetails.stats).some(k => playerDetails.stats[k] !== undefined) && (
                <div className="mb-5">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 text-center">Season Averages</div>
                  <div className="grid grid-cols-3 gap-2">
                    {activeSport === 'nba' && (
                      <>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">PTS</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.ppg?.toFixed?.(1) || playerDetails.stats.ppg || '—'}</div>
                        </div>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">REB</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.rpg?.toFixed?.(1) || playerDetails.stats.rpg || '—'}</div>
                        </div>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">AST</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.apg?.toFixed?.(1) || playerDetails.stats.apg || '—'}</div>
                        </div>
                      </>
                    )}
                    {activeSport === 'nfl' && (
                      <>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">YDS</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.passingYards || playerDetails.stats.rushingYards || playerDetails.stats.receivingYards || '—'}</div>
                        </div>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">TD</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.passingTDs || playerDetails.stats.rushingTDs || playerDetails.stats.receivingTDs || '—'}</div>
                        </div>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">{playerDetails.stats.receptions ? 'REC' : 'TKL'}</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.receptions || playerDetails.stats.tackles || '—'}</div>
                        </div>
                      </>
                    )}
                    {activeSport === 'mlb' && (
                      <>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">AVG</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.avg || '—'}</div>
                        </div>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">HR</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.hr || '—'}</div>
                        </div>
                        <div className="text-center py-3">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">RBI</div>
                          <div className="text-2xl font-bold text-blue-400">{playerDetails.stats.rbi || '—'}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Bio Info */}
              {!playerLoading && (
                <div className="flex items-center justify-center gap-4 py-3 border-t border-white/5">
                  {(playerDetails?.age || selectedPlayer.age) && (
                    <div className="text-center px-3">
                      <div className="text-sm font-medium">{playerDetails?.age || selectedPlayer.age}</div>
                      <div className="text-[10px] text-gray-500 uppercase">Age</div>
                    </div>
                  )}
                  {(playerDetails?.height || selectedPlayer.height) && (
                    <div className="text-center px-3 border-l border-white/5">
                      <div className="text-sm font-medium">{playerDetails?.height || selectedPlayer.height}</div>
                      <div className="text-[10px] text-gray-500 uppercase">Height</div>
                    </div>
                  )}
                  {(playerDetails?.experience || selectedPlayer.experience) && (
                    <div className="text-center px-3 border-l border-white/5">
                      <div className="text-sm font-medium">{playerDetails?.experience || selectedPlayer.experience}</div>
                      <div className="text-[10px] text-gray-500 uppercase">Years</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Notifications Modal */}
      {showNotifications && (
        <div className="fixed inset-0 flex items-start justify-center z-[100] pt-20" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }} onClick={() => setShowNotifications(false)}>
          <div className="bg-[#0a0a0f] w-full max-w-md rounded-3xl mx-4 border border-white/10 animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <span className="text-lg font-bold">Notifications</span>
              <AnimatedButton onClick={() => setShowNotifications(false)} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-gray-400"><Icons.X /></AnimatedButton>
            </div>
            <div className="p-5">
              <div className="text-center py-8 text-gray-500">No new notifications</div>
            </div>
          </div>
        </div>
      )}

      {/* Paywall */}
      {showPaywall && (
        <div className="fixed inset-0 flex items-end justify-center z-[100]" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }} onClick={() => setShowPaywall(false)}>
          <div className="bg-gradient-to-b from-[#0a0a0f] to-[#1a1a24] w-full max-w-md rounded-t-3xl relative" onClick={e => e.stopPropagation()}>
            <AnimatedButton onClick={() => setShowPaywall(false)} className="absolute top-4 right-4 w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-gray-400 z-10"><Icons.X /></AnimatedButton>
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-amber-500/30 text-black">
                <Icons.Crown />
              </div>
              <h2 className="text-2xl font-extrabold mb-2">Go Premium</h2>
              <p className="text-gray-400 mb-8">Enhanced viewing experience</p>
              <div className="text-left mb-8 space-y-3">
                {['Extended Game Insights', 'Real-Time Score Alerts', 'Detailed Team Statistics', 'Ad-Free Experience'].map(f => (
                  <div key={f} className="flex items-center gap-3 py-3 border-b border-white/5"><span className="text-emerald-400"><Icons.Check /></span><span>{f}</span></div>
                ))}
              </div>
              <div className="mb-6"><span className="text-4xl font-extrabold">$2.99</span><span className="text-gray-400">/month</span></div>
              <AnimatedButton primary onClick={() => { setSettings(p => ({ ...p, premium: true })); setShowPaywall(false); showToastMsg('Welcome to Premium!'); }} className="w-full py-4 bg-gradient-to-r from-yellow-400 to-amber-500 text-black rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-amber-500/30 transition-shadow">
                Start Free Trial
              </AnimatedButton>
              <p className="text-sm text-gray-500 mt-3">7-day free trial, cancel anytime</p>
              
              {/* Restore Purchases */}
              <button 
                onClick={() => { setShowPaywall(false); showToastMsg('Purchases will be restorable once available.'); }}
                className="w-full mt-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Restore Purchases
              </button>
              
              {/* Disclaimer */}
              <p className="text-[11px] text-gray-600 mt-4 leading-relaxed">
                Premium features provide enhanced game information for entertainment purposes only. No betting or gambling functionality included.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-24 left-1/2 bg-white text-black px-7 py-4 rounded-2xl font-semibold shadow-xl flex items-center gap-3 z-[200]" style={{ transform: 'translateX(-50%)' }}>
          <span className="text-emerald-500"><Icons.Check /></span>{toast}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
        .animate-pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
