/**
 * ProTrader Application Logic (Live TradingView Charts & US Market Autocomplete)
 * Connects frontend dashboard to local Express proxy, rendering TradingView
 * Lightweight Charts, managing multiple intraday intervals and historical ranges.
 */

// Predefined suggestion symbols
const SUGGESTED_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'GOOGL', 'AMZN', 'META', 'NFLX', 'AMD', 'JPM', 'KO'];

// Global State
let watchlist = [];
let stockDetails = {};
let activeStockSymbol = null;

// TradingView Lightweight Charts State
let chartInstance = null;
let lineSeries = null;
let candlestickSeries = null;

// Chart Controls State
let currentRange = '1d';       // '1d', '3mo', 'ytd', '1y', '5y', 'max'
let currentInterval = '5m';   // '5m', '15m', '1h', '1d', '1wk', '1mo'
let currentChartType = 'line'; // 'line' or 'candle'
let currentTableView = 'catalysts'; // 'catalysts' or 'compare'

// Handle file:// protocol loads by routing to local proxy
const API_BASE = (window.location.protocol === 'file:' || !window.location.host.includes('8080')) ? 'http://localhost:8080' : '';

// News Catalyst pools for Live AI Forecast HUD
const POSITIVE_CATALYST_POOL = [
    "Strong retail expenditure reports have fueled bullish sentiment across indices.",
    "Target price upgrades from institutional analysts are raising trading volume.",
    "Easing wholesale price indices support expectations of upcoming interest rate cuts.",
    "Corporate restructuring efficiencies are driving forward margin expansion forecasts.",
    "Global chip shipment rebounds signal accelerated recovery in hardware sectors."
];

const NEGATIVE_CATALYST_POOL = [
    "Unexpected supply constraints trigger fears of increased shipping logistics overheads.",
    "Rising bond yields and tightening federal commentary weigh on tech sector valuations.",
    "Regulatory audits introduce concerns regarding compliance delays on forward targets.",
    "Profit-taking activity accelerates ahead of tomorrow's macroeconomic reports.",
    "Labor dispute reports raise speculation of potential wage inflation spikes."
];

document.addEventListener('DOMContentLoaded', () => {
    initClock();
    loadWatchlist();
    setupEventListeners();
    simulateIndexTickerFluctuations();
    startNewsTicker();
    lucide.createIcons();
});

// 1. Live Clock Widget
function initClock() {
    const timeDisplay = document.getElementById('live-time');
    const updateTime = () => {
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    updateTime();
    setInterval(updateTime, 1000);
}

// 2. Load Watchlist
async function loadWatchlist() {
    const savedWatchlist = localStorage.getItem('protrader_watchlist');
    const savedDetails = localStorage.getItem('protrader_details');

    if (savedWatchlist && savedDetails) {
        watchlist = JSON.parse(savedWatchlist);
        stockDetails = JSON.parse(savedDetails);
        renderWatchlist();
        
        if (watchlist.length > 0) {
            selectStock(watchlist[0]);
            refreshWatchlistData();
        }
    } else {
        watchlist = ['AAPL', 'MSFT', 'TSLA'];
        renderWatchlist();
        if (watchlist.length > 0) {
            selectStock(watchlist[0]);
            refreshWatchlistData();
        }
    }
}

function saveToLocalStorage() {
    localStorage.setItem('protrader_watchlist', JSON.stringify(watchlist));
    localStorage.setItem('protrader_details', JSON.stringify(stockDetails));
}

// 3. Fetch Stock details from proxy backend API
async function fetchStockFromAPI(symbol, range = '1d', interval = '5m') {
    const response = await fetch(`${API_BASE}/api/stock/${symbol}?range=${range}&interval=${interval}`);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to fetch data for ${symbol}`);
    }
    return await response.json();
}

// 4. Background Watchlist Updater (Runs silently in background to keep prices fresh)
async function refreshWatchlistData() {
    for (const symbol of watchlist) {
        try {
            const data = await fetchStockFromAPI(symbol, '3mo', '1d');
            data.realWorldLastTime = data.history[data.history.length - 1].time;
            // Background refresh always fetches daily data — store as dailyHistory
            data.dailyHistory = data.history;
            // Preserve prediction stats from memory
            const existing = stockDetails[symbol];
            if (existing) {
                data.predictionsTotal = existing.predictionsTotal || 0;
                data.predictionsCorrect = existing.predictionsCorrect || 0;
                data.pendingForecast = existing.pendingForecast || null;
            }
            stockDetails[symbol] = data;
            saveToLocalStorage();
            
            if (symbol === activeStockSymbol && currentRange === '1d' && currentInterval === '5m') {
                renderStockDetails(data);
            }
            updateSidebarItem(symbol, data);
        } catch (err) {
            console.warn(`Background refresh failed for ${symbol}:`, err.message);
        }
    }
}

// 5. Select Stock to display details
async function selectStock(symbol) {
    activeStockSymbol = symbol;
    
    // Highlight sidebar item
    document.querySelectorAll('.watchlist-item').forEach(item => {
        if (item.dataset.symbol === symbol) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    // Reveal container
    document.getElementById('empty-detail-state').style.display = 'none';
    document.getElementById('active-stock-view').style.display = 'flex';

    // Fetch and Draw
    await fetchAndDrawStock(symbol, currentRange, currentInterval, true);
}

// Fetch stock and render it on UI
async function fetchAndDrawStock(symbol, range, interval, showSpinner = true) {
    if (showSpinner) setLoadingState(true);
    
    try {
        const data = await fetchStockFromAPI(symbol, range, interval);
        
        // Ensure user hasn't clicked away while waiting for async response
        if (activeStockSymbol === symbol && currentRange === range && currentInterval === interval) {
            data.realWorldLastTime = data.history[data.history.length - 1].time;

            if (range === '1d') {
                // For intraday charts, preserve the existing daily history for the table.
                // Only update the chart-facing history with 5m bars.
                const existing = stockDetails[symbol];
                data.dailyHistory = (existing && existing.dailyHistory && existing.dailyHistory.length > 0)
                    ? existing.dailyHistory
                    : (existing && existing.history ? existing.history : data.history);
                // Keep other prediction stats from previous session
                if (existing) {
                    data.predictionsTotal = existing.predictionsTotal || 0;
                    data.predictionsCorrect = existing.predictionsCorrect || 0;
                    data.pendingForecast = existing.pendingForecast || null;
                }
            } else {
                // For multi-day ranges, the history IS the daily history
                data.dailyHistory = data.history;
            }

            stockDetails[symbol] = data;
            saveToLocalStorage();
            setLoadingState(false);
            
            renderStockDetails(data);
            updateSidebarItem(symbol, data);
        }
    } catch (err) {
        setLoadingState(false);
        showToast(`Market Connection Error: ${err.message}`, 'info');
        
        const cachedData = stockDetails[symbol];
        if (cachedData) {
            renderStockDetails(cachedData);
        } else {
            document.getElementById('active-stock-view').style.display = 'none';
            document.getElementById('empty-detail-state').style.display = 'flex';
        }
    }
}

// Toggle loading spinner overlay
function setLoadingState(isLoading) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        if (isLoading) {
            loader.classList.add('active');
        } else {
            loader.classList.remove('active');
        }
    }
}

// 6. Draw details to dashboard
function renderStockDetails(stock) {
    document.getElementById('active-symbol').textContent = stock.symbol;
    document.getElementById('active-name').textContent = stock.name;
    document.getElementById('active-price').textContent = `$${stock.currentPrice.toFixed(2)}`;
    
    const changeBadge = document.getElementById('active-change-badge');
    const changeSign = stock.changePercent >= 0 ? '+' : '';
    changeBadge.textContent = `${changeSign}${stock.changePercent.toFixed(2)}%`;
    changeBadge.className = `active-change-badge ${stock.changePercent >= 0 ? 'trend-up' : 'trend-down'}`;

    // Stats Grid
    document.getElementById('stat-open').textContent = `$${stock.metrics.open.toFixed(2)}`;
    document.getElementById('stat-high').textContent = `$${stock.metrics.high.toFixed(2)}`;
    document.getElementById('stat-low').textContent = `$${stock.metrics.low.toFixed(2)}`;
    document.getElementById('stat-volume').textContent = stock.metrics.volume;
    document.getElementById('stat-mktcap').textContent = stock.metrics.mktcap;
    document.getElementById('stat-pe').textContent = stock.metrics.pe;
    document.getElementById('stat-52w-high').textContent = `$${stock.metrics.high52w.toFixed(2)}`;
    document.getElementById('stat-52w-low').textContent = `$${stock.metrics.low52w.toFixed(2)}`;

    // Draw active TradingView Chart
    renderTradingViewChart(stock);
    
    // Draw price table (reversed)
    renderPriceChangeHistory(stock);

    // Refresh earnings table data if the earnings tab is currently visible
    const earningsTab = document.getElementById('earnings-tab');
    if (earningsTab && earningsTab.classList.contains('active')) {
        renderEarningsTab(stock.symbol);
    }
}

// Update the AI circular accuracy indicator ring
function updateAccuracyRing(stock) {
    const total = stock.predictionsTotal || 0;
    const correct = stock.predictionsCorrect || 0;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 100;

    const circle = document.getElementById('accuracy-progress');
    const percentageText = document.getElementById('accuracy-percentage');
    const ratioText = document.getElementById('accuracy-ratio');

    if (circle && percentageText && ratioText) {
        const circumference = 119.38; // r=19 -> 2 * pi * r = 119.38
        const offset = circumference - (percent / 100) * circumference;
        circle.style.strokeDashoffset = offset;
        
        percentageText.textContent = `${percent}%`;
        ratioText.textContent = `${correct}/${total}`;
        
        // Color-code ring based on success percentage
        if (total === 0) {
            circle.setAttribute('stroke', '#a855f7'); // default purple
        } else if (percent >= 70) {
            circle.setAttribute('stroke', '#10b981'); // green (great)
        } else if (percent >= 50) {
            circle.setAttribute('stroke', '#f59e0b'); // amber (moderate)
        } else {
            circle.setAttribute('stroke', '#ef4444'); // red (low)
        }
    }
}

// Render the forecast values inside the Live AI HUD Card
function renderForecastHUD(stock) {
    if (!stock.pendingForecast) {
        simulateForecastUpdate(stock);
    }
    
    const directionEl = document.getElementById('forecast-direction');
    const confidenceEl = document.getElementById('forecast-confidence');
    const catalystEl = document.getElementById('forecast-catalyst');
    
    if (directionEl && confidenceEl && catalystEl) {
        const isPositive = stock.pendingForecast.direction === 'Positive';
        
        if (isPositive) {
            directionEl.textContent = '🟢 Positive';
            directionEl.className = 'hud-value-compact text-up';
        } else {
            directionEl.textContent = '🔴 Negative';
            directionEl.className = 'hud-value-compact text-down';
        }
        
        confidenceEl.textContent = `${stock.pendingForecast.confidence}%`;
        catalystEl.textContent = `"${stock.pendingForecast.catalyst}"`;
    }
}

// Generate a random simulated forecast for a stock based on recent trend direction
function simulateForecastUpdate(stock) {
    const hist = stock.history;
    let sentiment = 'Positive';
    
    if (hist.length >= 3) {
        const lastClose = hist[hist.length - 1].close;
        const prevClose = hist[hist.length - 3].close;
        const isUpTrend = lastClose >= prevClose;
        
        // 65% chance to mirror current daily price trend, 35% random surprise
        if (Math.random() < 0.65) {
            sentiment = isUpTrend ? 'Positive' : 'Negative';
        } else {
            sentiment = isUpTrend ? 'Negative' : 'Positive';
        }
    } else {
        sentiment = Math.random() < 0.5 ? 'Positive' : 'Negative';
    }

    const confidence = Math.floor(55 + Math.random() * 40); // 55% to 95%
    const pool = sentiment === 'Positive' ? POSITIVE_CATALYST_POOL : NEGATIVE_CATALYST_POOL;
    const catalyst = pool[Math.floor(Math.random() * pool.length)];

    stock.pendingForecast = {
        direction: sentiment,
        confidence: confidence,
        catalyst: catalyst
    };
}

// Setup background interval task to track news feeds automatically
function startNewsTicker() {
    setInterval(() => {
        // Refresh forecast updates on all watchlist items
        watchlist.forEach(symbol => {
            const stock = stockDetails[symbol];
            if (stock) {
                simulateForecastUpdate(stock);
            }
        });
        
        saveToLocalStorage();
        
        // Update active HUD in real-time
        if (activeStockSymbol && stockDetails[activeStockSymbol]) {
            renderForecastHUD(stockDetails[activeStockSymbol]);
            
            // Re-trigger pulsing animations on sweep indicator
            const pulseIcon = document.querySelector('.hud-pulse-icon');
            if (pulseIcon) {
                pulseIcon.style.animation = 'none';
                pulseIcon.offsetHeight; // trigger reflow
                pulseIcon.style.animation = 'pulseIcon 1.5s infinite ease-in-out';
            }
        }
    }, 20000); // 20s interval for local browser verification (equivalent to 15m)
}

// Update single item values in the sidebar list (avoids heavy DOM rebuilds)
function updateSidebarItem(symbol, stock) {
    const itemEl = document.querySelector(`.watchlist-item[data-symbol="${symbol}"]`);
    if (!itemEl) return;
    
    const priceEl = itemEl.querySelector('.watchlist-price');
    const badgeEl = itemEl.querySelector('.watchlist-change-badge');
    
    priceEl.textContent = `$${stock.currentPrice.toFixed(2)}`;
    
    const changeSign = stock.changePercent >= 0 ? '+' : '';
    badgeEl.textContent = `${changeSign}${stock.changePercent.toFixed(2)}%`;
    
    badgeEl.className = `watchlist-change-badge ${stock.changePercent >= 0 ? 'trend-up' : 'trend-down'}`;
}

/// 7. Render TradingView Lightweight Chart (Interactive Candlestick/Line Layout)
function renderTradingViewChart(stock) {
    const container = document.getElementById('tv-chart');
    if (!container) return;

    const isIntraday = (currentRange === '1d');

    // Compute Eastern timezone offset in seconds so we can shift intraday timestamps
    // This makes LightweightCharts show 9:30 AM instead of 13:30 UTC
    function getEasternOffsetSecs() {
        const now = new Date();
        const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
        const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
        return (new Date(utcStr) - new Date(etStr)) / 1000; // e.g. 14400 for EDT
    }
    const etOffset = isIntraday ? getEasternOffsetSecs() : 0;

    // Always destroy existing chart so config always matches the selected range
    if (chartInstance) {
        if (lineSeries) { try { chartInstance.removeSeries(lineSeries); } catch(e){} lineSeries = null; }
        if (candlestickSeries) { try { chartInstance.removeSeries(candlestickSeries); } catch(e){} candlestickSeries = null; }
        chartInstance.remove();
        chartInstance = null;
        container.innerHTML = '';
    }

    chartInstance = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: '#141a23' },
            textColor: '#94a3b8',
            fontSize: 11,
            fontFamily: 'Plus Jakarta Sans',
        },
        localization: {
            timeFormatter: (t) => {
                // t is already shifted to ET, so treat as UTC display
                const d = new Date(t * 1000);
                if (isIntraday) {
                    const hh = String(d.getUTCHours()).padStart(2, '0');
                    const mm = String(d.getUTCMinutes()).padStart(2, '0');
                    return `${hh}:${mm}`;
                }
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.03)' },
            horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.08)',
            scaleMargins: { top: 0.12, bottom: 0.08 },
        },
        timeScale: {
            borderColor: 'rgba(255,255,255,0.08)',
            timeVisible: true,
            secondsVisible: false,
            tickMarkFormatter: (t) => {
                const d = new Date(t * 1000);
                if (isIntraday) {
                    // t is already ET-shifted, show as UTC hours in 24h format
                    const hh = String(d.getUTCHours()).padStart(2, '0');
                    const mm = String(d.getUTCMinutes()).padStart(2, '0');
                    return `${hh}:${mm}`;
                }
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
            },
            fixLeftEdge: isIntraday,
            fixRightEdge: isIntraday,
        },
    });

    const resObs = new ResizeObserver(entries => {
        if (!entries.length || !chartInstance) return;
        const { width, height } = entries[0].contentRect;
        chartInstance.resize(width, height);
    });
    resObs.observe(container);

    // Filter history to the selected range
    let displayHistory = stock.history;
    if (currentRange === '1y') {
        displayHistory = stock.history.slice(-252);
    } else if (currentRange === 'ytd') {
        const yr = new Date().getFullYear();
        displayHistory = stock.history.filter(d => new Date(d.time * 1000).getFullYear() === yr);
    } else if (currentRange === '3mo') {
        displayHistory = stock.history.slice(-63);
    }

    const isUp = stock.changePercent >= 0;
    const colorPrimary = isUp ? '#10b981' : '#ef4444';
    const colorFaint   = isUp ? '#10b98122' : '#ef444422';

    if (currentChartType === 'line') {
        if (isIntraday) {
            // Draw a continuous unified 24h intraday line from 04:00 to 20:00 ET (just like Robinhood)
            const mainSeries = chartInstance.addAreaSeries({
                lineColor: colorPrimary,
                topColor: colorPrimary + '44',
                bottomColor: colorPrimary + '00',
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 4,
                crosshairMarkerBorderColor: colorPrimary,
                crosshairMarkerBackgroundColor: '#ffffff',
            });
            mainSeries.setData(displayHistory.map(d => ({ time: d.time - etOffset, value: d.close })));

            // Previous close dashed baseline
            const prevClose = stock.history[0]?.open ?? stock.currentPrice;
            mainSeries.createPriceLine({
                price: prevClose,
                color: 'rgba(148,163,184,0.35)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'Prev Close',
            });
            lineSeries = mainSeries;

            // Add session label markers at market open
            const openBar = displayHistory.find(d => d.session === 'regular');
            if (openBar) {
                const regRef = chartInstance.addLineSeries({ color: 'transparent', priceLineVisible: false, lastValueVisible: false, lineWidth: 0 });
                regRef.setData([{ time: openBar.time - etOffset, value: openBar.close }]);
                regRef.setMarkers([{
                    time: openBar.time - etOffset,
                    position: 'belowBar',
                    color: 'rgba(148,163,184,0.6)',
                    shape: 'arrowUp',
                    text: 'Open',
                    size: 0.8,
                }]);
            }

        } else {
            lineSeries = chartInstance.addLineSeries({
                color: colorPrimary,
                lineWidth: 2.5,
                priceLineVisible: false,
                lastValueVisible: true,
            });
            const lineData = displayHistory.map(d => ({ time: d.time, value: d.close }));
            lineSeries.setData(lineData);
        }
    } else {
        // Candlestick view
        candlestickSeries = chartInstance.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#10b981',
            wickDownColor: '#ef4444',
            wickUpColor: '#10b981',
            priceLineVisible: false,
            lastValueVisible: true,
        });
        const candleData = displayHistory.map(d => ({
            time: isIntraday ? d.time - etOffset : d.time,
            open: d.open, high: d.high, low: d.low, close: d.close
        }));
        candlestickSeries.setData(candleData);
    }

    chartInstance.timeScale().fitContent();
}

// Find closest trading day in history based on Unix seconds target
function findClosestTradingDay(history, targetTime) {
    let closest = null;
    let minDiff = Infinity;
    for (const day of history) {
        const diff = Math.abs(day.time - targetTime);
        // Match must be within 10 days of the target date to be valid
        if (diff < minDiff && diff < 10 * 86400) {
            minDiff = diff;
            closest = day;
        }
    }
    return closest;
}

// 8. Render Table of Daily Price changes with Catalyst Reasons / Comparisons
function renderPriceChangeHistory(stock) {
    const tbody = document.getElementById('history-rows');
    const thead = document.getElementById('history-thead');
    if (!tbody || !thead) return;
    
    tbody.innerHTML = '';
    
    // Toggle header layout
    if (currentTableView === 'catalysts') {
        thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Closing Price</th>
                <th>Change (%)</th>
                <th>Catalyst & Market Reason</th>
            </tr>
        `;
    } else {
        thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Closing Price</th>
                <th>1 Year Ago Price</th>
                <th>% Diff vs 1Y</th>
            </tr>
        `;
    }
    
    // Always use dailyHistory for the table (daily bars only, never 5-min intraday)
    const tableSource = stock.dailyHistory && stock.dailyHistory.length > 0
        ? stock.dailyHistory
        : stock.history;
    const reversedHistory = [...tableSource].reverse().slice(0, 50);

    reversedHistory.forEach((day) => {
        const row = document.createElement('tr');
        
        if (currentTableView === 'catalysts') {
            const changeClass = day.changePercent >= 0 ? 'text-up' : 'text-down';
            const changeSign = day.changePercent >= 0 ? '+' : '';
            const trendIcon = day.changePercent >= 0 ? 'trending-up' : 'trending-down';
            
            row.innerHTML = `
                <td class="history-date">${day.date}</td>
                <td class="history-price font-heading">$${day.close.toFixed(2)}</td>
                <td class="history-change ${changeClass} font-heading">
                    <span style="display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="${trendIcon}" style="width: 14px; height: 14px;"></i>
                        ${changeSign}${day.changePercent.toFixed(2)}%
                    </span>
                </td>
                <td class="history-reason">${day.reason}</td>
            `;
        } else {
            // Find closest trading day 1 Year ago (365 days ago)
            const day1Y = findClosestTradingDay(tableSource, day.time - 365 * 86400);

            let price1YText = '<span class="text-muted">N/A</span>';
            let diff1YHtml = '<span class="text-muted">N/A</span>';
            if (day1Y) {
                price1YText = `$${day1Y.close.toFixed(2)} <span class="text-muted" style="font-size:0.75rem;">(${day1Y.date})</span>`;
                const diffPct = ((day.close - day1Y.close) / day1Y.close) * 100;
                const sign = diffPct >= 0 ? '+' : '';
                const klass = diffPct >= 0 ? 'text-up' : 'text-down';
                diff1YHtml = `<span class="${klass} font-heading">${sign}${diffPct.toFixed(2)}%</span>`;
            }

            row.innerHTML = `
                <td class="history-date">${day.date}</td>
                <td class="history-price font-heading">$${day.close.toFixed(2)}</td>
                <td class="history-reason">${price1YText}</td>
                <td class="history-change">${diff1YHtml}</td>
            `;
        }
        
        tbody.appendChild(row);
    });
    
    lucide.createIcons();
}

// 9b. Render Quarterly Earnings Tab
async function renderEarningsTab(symbol) {
    const loadingEl = document.getElementById('earnings-loading');
    const tableEl   = document.getElementById('earnings-table');
    const emptyEl   = document.getElementById('earnings-empty');
    const tbody     = document.getElementById('earnings-rows');
    if (!loadingEl || !tableEl || !tbody) return;

    // Reset state
    loadingEl.style.display = 'block';
    tableEl.style.display   = 'none';
    emptyEl.style.display   = 'none';
    tbody.innerHTML = '';

    try {
        const resp = await fetch(`${API_BASE}/api/earnings/${symbol}`);
        const data = await resp.json();

        loadingEl.style.display = 'none';

        // Render upcoming earnings metadata block
        const nextMetaEl = document.getElementById('earnings-next-meta');
        const nextDateEl = document.getElementById('earnings-next-date');
        const nextEstEl  = document.getElementById('earnings-next-estimate');

        if (nextMetaEl && nextDateEl && nextEstEl) {
            if (data.nextEarningsDate) {
                // Parse date string (YYYY-MM-DD) cleanly to avoid timezone shift shifts
                const parts = data.nextEarningsDate.split('-');
                const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
                const formattedDate = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                
                nextDateEl.textContent = formattedDate;
                let estText = data.nextEarningsEstimate != null ? `$${data.nextEarningsEstimate.toFixed(2)} EPS` : '';
                if (data.nextRevenueEstimate != null) {
                    const revB = (data.nextRevenueEstimate / 1e9).toFixed(2);
                    estText += (estText ? '  ·  ' : '') + `$${revB}B Rev`;
                }
                nextEstEl.textContent = estText || 'N/A';
                nextMetaEl.style.display = 'block';
            } else {
                nextMetaEl.style.display = 'none';
            }
        }

        if (!data.quarters || data.quarters.length === 0) {
            emptyEl.style.display = 'block';
            return;
        }

        data.quarters.forEach(q => {
            const row = document.createElement('tr');

            // ── EPS ──
            const epsActual = q.epsActual  != null ? `$${q.epsActual.toFixed(2)}`  : '<span class="text-muted">N/A</span>';
            const epsEst    = q.epsEstimate != null ? `$${q.epsEstimate.toFixed(2)}` : '<span class="text-muted">N/A</span>';

            // ── Surprise % ──
            let surpriseHtml = '<span class="text-muted">N/A</span>';
            if (q.surprisePercent != null) {
                const cls  = q.surprisePercent >= 0 ? 'text-up' : 'text-down';
                const sign = q.surprisePercent >= 0 ? '+' : '';
                surpriseHtml = `<span class="${cls} font-heading">${sign}${q.surprisePercent.toFixed(2)}%</span>`;
            }

            // ── Beat / Miss / Inline badge ──
            let beatHtml = '<span class="text-muted">—</span>';
            if (q.beat === true || q.beat === 'beat') {
                beatHtml = `<span class="earnings-badge beat">✅ BEAT</span>`;
            } else if (q.beat === false || q.beat === 'miss') {
                beatHtml = `<span class="earnings-badge miss">❌ MISS</span>`;
            } else if (q.beat === 'inline') {
                beatHtml = `<span class="earnings-badge inline" style="background: rgba(241, 196, 15, 0.1); border: 1px solid rgba(241, 196, 15, 0.3); color: #f1c40f; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">🤝 INLINE</span>`;
            }

            // ── 24h Price Reaction (Earnings Day Close → Next Trading Day Close) ──
            // Earnings are reported after 4 PM ET close — the real market reaction
            // happens the NEXT trading day. We show that full 24-hour window.
            let reactionHtml = '<span class="text-muted">N/A</span>';
            let tradePct = null;

            if (q.nextDayClose != null && q.priceClose != null) {
                // Best case: we have both earnings-day close AND next-day close
                tradePct = q.nextDayChangePercent;
                const dir = tradePct >= 0 ? '▲' : '▼';
                const cls = tradePct >= 0 ? 'text-up' : 'text-down';
                reactionHtml = `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <span class="font-heading" style="font-size:0.82rem;">
                            $${q.priceClose.toFixed(2)}
                            <span style="color:var(--text-muted);margin:0 3px;">→</span>
                            $${q.nextDayClose.toFixed(2)}
                        </span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">
                            Earn. close → next day close
                        </span>
                    </div>`;
            }

            // ── 24h % Change badge ──
            let tradeHtml = '<span class="text-muted">N/A</span>';
            if (tradePct != null) {
                const cls  = tradePct >= 0 ? 'text-up' : 'text-down';
                const sign = tradePct >= 0 ? '+' : '';
                const icon = tradePct >= 0 ? 'trending-up' : 'trending-down';
                const bg   = tradePct >= 0 ? 'var(--green-up-bg)' : 'var(--red-down-bg)';
                const border = tradePct >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)';
                tradeHtml = `
                    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
                        <span class="${cls} font-heading" style="font-size:1rem;font-weight:800;display:inline-flex;align-items:center;gap:4px;
                            background:${bg};border:1px solid ${border};padding:4px 10px;border-radius:8px;">
                            <i data-lucide="${icon}" style="width:13px;height:13px;"></i>
                            ${sign}${tradePct.toFixed(2)}%
                        </span>
                        <span style="font-size:0.68rem;color:var(--text-muted);">24h after report</span>
                    </div>`;
            }

            // ── Revenue ──
            let revenueHtml = '<span class="text-muted">N/A</span>';
            if (q.revenueFmt) {
                revenueHtml = `<span class="font-heading" style="font-size:0.88rem;">${q.revenueFmt}</span>`;
            } else if (q.revenue != null) {
                const rev = q.revenue;
                let revStr;
                if (rev >= 1e9) revStr = `$${(rev / 1e9).toFixed(2)}B`;
                else if (rev >= 1e6) revStr = `$${(rev / 1e6).toFixed(1)}M`;
                else revStr = `$${rev.toLocaleString()}`;
                revenueHtml = `<span class="font-heading" style="font-size:0.88rem;">${revStr}</span>`;
            }

            row.innerHTML = `
                <td class="history-date">${q.quarter}</td>
                <td class="history-price font-heading">${epsActual}</td>
                <td class="history-price">${epsEst}</td>
                <td class="history-change">${surpriseHtml}</td>
                <td>${beatHtml}</td>
                <td>${revenueHtml}</td>
                <td>${reactionHtml}</td>
                <td>${tradeHtml}</td>
            `;
            tbody.appendChild(row);
        });

        tableEl.style.display = 'table';
        lucide.createIcons();
    } catch (err) {
        loadingEl.style.display = 'none';
        emptyEl.textContent = `Failed to load earnings: ${err.message}`;
        emptyEl.style.display = 'block';
    }
}

// 9c. Render Economic Indicators Tab
let currentIndicatorTier = 'Tier 1 (Primary)'; // Default tier state
let cachedIndicators = null; // Memory cache to avoid repeated fetch

async function renderEconomicIndicators(forceFetch = false) {
    const loadingEl = document.getElementById('indicators-loading');
    const containerEl = document.getElementById('indicators-list-container');
    if (!loadingEl || !containerEl) return;

    if (!cachedIndicators || forceFetch) {
        loadingEl.style.display = 'block';
        containerEl.innerHTML = '';
        try {
            const resp = await fetch(`${API_BASE}/api/indicators`);
            if (!resp.ok) throw new Error("Could not fetch indicator releases.");
            cachedIndicators = await resp.json();
        } catch (e) {
            loadingEl.style.display = 'none';
            containerEl.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted);">${e.message}</div>`;
            return;
        }
    }

    loadingEl.style.display = 'none';
    containerEl.innerHTML = '';

    const filtered = cachedIndicators.filter(ind => ind.tier.includes(currentIndicatorTier));

    if (filtered.length === 0) {
        containerEl.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted);">No indicators found for ${currentIndicatorTier}.</div>`;
        return;
    }

    // Grid layout for Indicators
    const grid = document.createElement('div');
    grid.className = 'indicators-grid';
    
    filtered.forEach(ind => {
        const card = document.createElement('div');
        card.className = 'indicator-card';
        
        // Format triggers list
        const triggerHtml = `
            <div class="indicator-triggers">
                <div class="trigger-row">
                    <span class="trigger-label">Why It Increases:</span>
                    <span class="trigger-desc">${ind.triggers.increase}</span>
                </div>
                <div class="trigger-row">
                    <span class="trigger-label">Why It Decreases:</span>
                    <span class="trigger-desc">${ind.triggers.decrease}</span>
                </div>
                <div class="trigger-row reaction">
                    <span class="trigger-label">Stock Market Reaction:</span>
                    <span class="trigger-desc highlight">${ind.triggers.reaction}</span>
                </div>
            </div>
        `;

        // Format history table for past 6 months
        let historyRows = '';
        ind.history.forEach(h => {
            const statusCls = h.change === 'up' ? 'text-up' : (h.change === 'down' ? 'text-down' : 'text-stable');
            const icon = h.change === 'up' ? '▲' : (h.change === 'down' ? '▼' : '■');
            historyRows += `
                <tr>
                    <td>${h.period}</td>
                    <td class="font-heading font-bold">${h.value}</td>
                    <td>
                        <span class="${statusCls}" style="display:inline-flex; align-items:center; gap:2px; font-weight:700;">
                            <span style="font-size:0.6rem;">${icon}</span> ${h.status}
                        </span>
                    </td>
                </tr>
            `;
        });

        const historyHtml = `
            <div class="indicator-history-wrapper">
                <span class="history-title">Past 6 Releases</span>
                <table class="mini-history-table">
                    <thead>
                        <tr>
                            <th>Release Month</th>
                            <th>Reported Value</th>
                            <th>Economic Assessment</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${historyRows}
                    </tbody>
                </table>
            </div>
        `;

        // Parse human-readable Next date (parse string parts directly to avoid timezone-related day shifts)
        const dateParts = ind.nextDate.split('-');
        let nextAnnouncement = ind.nextDate;
        if (dateParts.length === 3) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const year = dateParts[0];
            const monthIdx = parseInt(dateParts[1], 10) - 1;
            const day = parseInt(dateParts[2], 10);
            if (monthIdx >= 0 && monthIdx < 12) {
                nextAnnouncement = `${months[monthIdx]} ${day}, ${year}`;
            }
        }

        card.innerHTML = `
            <div class="indicator-card-header">
                <div class="indicator-title-badge">
                    <h4>${ind.name}</h4>
                    <span class="badge ${ind.tier.includes('Tier 1') ? 'badge-primary' : 'badge-secondary'}">${ind.frequency}</span>
                </div>
                <div class="indicator-next">
                    <span class="next-label">Next Release</span>
                    <span class="next-date font-heading">${nextAnnouncement}${ind.releaseTime ? ' @ ' + ind.releaseTime : ''}</span>
                </div>
            </div>
            <p class="indicator-description">${ind.description}</p>
            <div class="indicator-body-flex">
                ${triggerHtml}
                ${historyHtml}
            </div>
            <div class="indicator-source-footer" style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted);">
                <span>Source: <a href="${ind.sourceUrl}" target="_blank" style="color: var(--primary-color); text-decoration: none; font-weight: 600;">${ind.sourceName}</a></span>
                <span style="font-size: 0.65rem; background: rgba(255,255,255,0.02); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">Verified Data</span>
            </div>
        `;
        grid.appendChild(card);
    });

    containerEl.appendChild(grid);
    lucide.createIcons();
}


// 9. Add Stock to Watchlist
async function addToWatchlist(symbolInput) {
    const symbol = symbolInput.toUpperCase().trim();
    if (!symbol) return;

    if (watchlist.includes(symbol)) {
        showToast(`Stock ${symbol} is already in your watchlist.`, 'info');
        clearSearchUI();
        selectStock(symbol);
        return;
    }

    showToast(`Adding ${symbol} to tracker. Loading live charts...`, 'info');

    try {
        const stockData = await fetchStockFromAPI(symbol, currentRange, currentInterval);
        stockData.realWorldLastTime = stockData.history[stockData.history.length - 1].time;
        watchlist.unshift(symbol);
        stockDetails[symbol] = stockData;
        saveToLocalStorage();
        renderWatchlist();
        selectStock(symbol);
        
        showToast(`Added ${symbol} (${stockData.name}) from real market feeds!`, 'success');
        clearSearchUI();
    } catch (err) {
        showToast(`Could not find symbol: ${symbol}. Check connection or ticker.`, 'info');
    }
}

// Clear Search UI elements
function clearSearchUI() {
    const searchInput = document.getElementById('stock-search');
    const clearBtn = document.getElementById('clear-search');
    const searchDropdown = document.getElementById('search-results');
    
    searchInput.value = '';
    clearBtn.style.display = 'none';
    searchDropdown.style.display = 'none';
}

// 10. Remove Stock
function removeFromWatchlist(symbol) {
    watchlist = watchlist.filter(s => s !== symbol);
    delete stockDetails[symbol];
    
    saveToLocalStorage();
    renderWatchlist();
    showToast(`Removed ${symbol} from Watchlist.`, 'info');

    if (activeStockSymbol === symbol) {
        if (watchlist.length > 0) {
            selectStock(watchlist[0]);
        } else {
            activeStockSymbol = null;
            document.getElementById('active-stock-view').style.display = 'none';
            document.getElementById('empty-detail-state').style.display = 'flex';
        }
    }
}

// Helper to check for national stock market holidays
function getMarketHolidayName(date) {
    const month = date.toLocaleString('default', { month: 'short' });
    const day = date.getDate();
    const key = `${month} ${day}`;
    
    const holidays = {
        'Jan 1': "New Year's Day",
        'Jul 4': "Independence Day",
        'Dec 25': "Christmas Day"
    };
    return holidays[key] || null;
}

// 11. Predict Tomorrow business day (Incremental update & prediction score logic with weekend delay)
function simulateNextDay() {
    if (!activeStockSymbol) return;

    const stock = stockDetails[activeStockSymbol];
    if (!stock) return;

    const latestTime = stock.history[stock.history.length - 1].time;
    const realLastTime = stock.realWorldLastTime || 0;
    
    // Prevent predicting more than 1 trading day in advance of real market data
    if (realLastTime > 0 && latestTime > realLastTime) {
        showToast("Limit Reached: You can only predict the next trading day.", "info");
        return;
    }

    // Get latest item in history
    const latestDay = stock.history[stock.history.length - 1];
    const latestDate = new Date(latestDay.date + " 12:00:00");
    latestDate.setDate(latestDate.getDate() + 1);
    
    const holidayName = getMarketHolidayName(latestDate);
    const dayOfWeek = latestDate.getDay(); // 0 = Sunday, 6 = Saturday

    // Check if next day falls on Saturday, Sunday, or a holiday
    if (dayOfWeek === 6 || dayOfWeek === 0 || holidayName) {
        const overlay = document.getElementById('market-closed-overlay');
        const titleEl = document.getElementById('market-closed-title');
        const descEl = document.getElementById('market-closed-desc');
        const textEl = document.getElementById('countdown-text');
        const barEl = document.getElementById('countdown-bar');

        if (overlay && titleEl && descEl && textEl && barEl) {
            if (holidayName) {
                titleEl.textContent = `Market Closed: ${holidayName}`;
                descEl.textContent = `Trading is suspended for the holiday. Waiting for the next market open...`;
            } else {
                titleEl.textContent = `Market Closed for Weekend`;
                descEl.textContent = `The market is closed. Waiting for Sunday 18:00 EST Futures opening...`;
            }

            overlay.style.display = 'flex';
            
            // Disable button during countdown
            const predictBtn = document.getElementById('simulate-day-btn');
            if (predictBtn) predictBtn.disabled = true;

            // Start 5 second visual countdown
            let secondsLeft = 5;
            textEl.textContent = `Opening in ${secondsLeft} seconds...`;
            barEl.style.transition = 'none';
            barEl.style.transform = 'scaleX(1)';
            
            // Force layout reflow
            barEl.offsetHeight;
            
            barEl.style.transition = 'transform 5s linear';
            barEl.style.transform = 'scaleX(0)';

            const intervalId = setInterval(() => {
                secondsLeft -= 1;
                if (secondsLeft > 0) {
                    textEl.textContent = `Opening in ${secondsLeft} seconds...`;
                } else {
                    clearInterval(intervalId);
                    overlay.style.display = 'none';
                    if (predictBtn) predictBtn.disabled = false;
                    
                    // Advance simulated date past weekend/holiday
                    if (dayOfWeek === 6) latestDate.setDate(latestDate.getDate() + 2); // Saturday -> Monday
                    else if (dayOfWeek === 0) latestDate.setDate(latestDate.getDate() + 1); // Sunday -> Monday
                    
                    resolvePredictionAndAppend(stock, latestDate);
                }
            }, 1000);
        }
    } else {
        // Weekday: resolve instantly
        resolvePredictionAndAppend(stock, latestDate);
    }
}

// Append simulated details and check accuracy
function resolvePredictionAndAppend(stock, latestDate) {
    // AI Prediction step - mapped directly to the pending forecast of the HUD
    if (!stock.pendingForecast) {
        simulateForecastUpdate(stock);
    }
    const predictedDirection = stock.pendingForecast.direction === 'Positive' ? 'UP' : 'DOWN';

    // Actual close movement
    const changePercent = +(Math.random() * 7 - 3.5).toFixed(2);
    const actualDirection = changePercent >= 0 ? 'UP' : 'DOWN';
    const isCorrect = predictedDirection === actualDirection;

    if (!stock.predictionsTotal) stock.predictionsTotal = 0;
    if (!stock.predictionsCorrect) stock.predictionsCorrect = 0;

    stock.predictionsTotal += 1;
    if (isCorrect) {
        stock.predictionsCorrect += 1;
    }

    const oldPrice = stock.currentPrice;
    const priceDelta = oldPrice * (changePercent / 100);
    const newPrice = +(oldPrice + priceDelta).toFixed(2);

    const open = oldPrice;
    const close = newPrice;
    const fluctuation = Math.random() * 2;
    const high = +(Math.max(open, close) * (1 + fluctuation / 100)).toFixed(2);
    const low = +(Math.min(open, close) * (1 - fluctuation / 100)).toFixed(2);
    const volumeVal = Math.floor(10 + Math.random() * 90) / 10;

    let pool;
    if (changePercent > 0.5) {
        pool = ['beat analyst estimates, sparking positive investor sentiment.', 'announced a strategic efficiency restructuring program.', 'surged on sector-wide buying pressure and easing inflation fears.'];
    } else if (changePercent < -0.5) {
        pool = ['faced selling pressure on fears of margin erosion and wage growth.', 'issued lower Q3 guidance due to soft logistics reports.', 'declined amid a wider sector correction and rising bond rates.'];
    } else {
        pool = ['remained unchanged as traders wait for federal policy adjustments.', 'moved sideways on low volumes.', 'traded in a thin band in the absence of news.'];
    }
    const template = pool[Math.floor(Math.random() * pool.length)];
    const marketUpdate = `${stock.name} ${template}`;

    const predTag = predictedDirection === 'UP' ? '🟢 Positive' : '🔴 Negative';
    const resultTag = isCorrect ? 'CORRECT' : 'INCORRECT';
    const reasonText = `[AI Forecast: predicted ${predTag} (Result: ${resultTag})] - ${marketUpdate}`;

    const nextTimeSeconds = Math.round(latestDate.getTime() / 1000);
    const newDayData = {
        time: nextTimeSeconds,
        date: `${latestDate.toLocaleString('default', { month: 'short' })} ${latestDate.getDate()}, ${latestDate.getFullYear()}`,
        open: +open.toFixed(2),
        high: high,
        low: low,
        close: close,
        changePercent: changePercent,
        volume: `${volumeVal}M`,
        reason: reasonText
    };

    stock.history.push(newDayData);
    if (stock.history.length > 250) {
        stock.history.shift();
    }

    stock.currentPrice = newPrice;
    stock.changePercent = changePercent;
    stock.metrics.open = open;
    stock.metrics.high = high;
    stock.metrics.low = low;
    stock.metrics.volume = `${volumeVal}M`;

    // Regenerate a fresh pending forecast for the following trading day
    simulateForecastUpdate(stock);

    stockDetails[activeStockSymbol] = stock;

    saveToLocalStorage();
    updateSidebarItem(activeStockSymbol, stock);
    renderStockDetails(stock);

    const sign = changePercent >= 0 ? '+' : '';
    const predWord = predictedDirection === 'UP' ? 'Positive' : 'Negative';
    const actualWord = actualDirection === 'UP' ? 'Positive' : 'Negative';

    if (isCorrect) {
        showToast(`🔮 AI Forecast SUCCESS! Predicted ${predWord} and ${stock.symbol} went ${actualWord} (${sign}${changePercent}%)`, 'success');
    } else {
        showToast(`🔮 AI Forecast FAILED. Predicted ${predWord} but ${stock.symbol} went ${actualWord} (${sign}${changePercent}%)`, 'info');
    }
}

// 12. Render Watchlist DOM items
function renderWatchlist() {
    const container = document.getElementById('watchlist-container');
    const emptyMsg = document.getElementById('empty-watchlist-msg');
    
    container.querySelectorAll('.watchlist-item').forEach(el => el.remove());

    if (watchlist.length === 0) {
        emptyMsg.style.display = 'flex';
        document.getElementById('watchlist-count').textContent = '0';
        return;
    }

    emptyMsg.style.display = 'none';
    document.getElementById('watchlist-count').textContent = watchlist.length;

    watchlist.forEach(symbol => {
        const stock = stockDetails[symbol];
        if (!stock) return;

        const isSelected = symbol === activeStockSymbol;
        const changeClass = stock.changePercent >= 0 ? 'trend-up' : 'trend-down';
        const changeSign = stock.changePercent >= 0 ? '+' : '';

        const item = document.createElement('div');
        item.className = `watchlist-item ${isSelected ? 'selected' : ''}`;
        item.dataset.symbol = symbol;
        
        item.innerHTML = `
            <div class="watchlist-item-left">
                <span class="watchlist-symbol">${stock.symbol}</span>
                <span class="watchlist-name">${stock.name}</span>
            </div>
            <div class="watchlist-item-right">
                <span class="watchlist-price">$${stock.currentPrice.toFixed(2)}</span>
                <div class="watchlist-change-badge ${changeClass}">
                    ${changeSign}${stock.changePercent.toFixed(2)}%
                </div>
                <button class="delete-watchlist-btn" title="Remove Stock">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-watchlist-btn')) {
                e.stopPropagation();
                removeFromWatchlist(symbol);
                return;
            }
            selectStock(symbol);
        });

        container.appendChild(item);
    });

    lucide.createIcons();
}

// 13. Event Binding
function setupEventListeners() {
    const searchInput = document.getElementById('stock-search');
    const clearBtn = document.getElementById('clear-search');
    const searchDropdown = document.getElementById('search-results');
    let searchTimeout = null;

    // Search Box Listener (Live debounced autocomplete querying backend API)
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (!query) {
            clearBtn.style.display = 'none';
            searchDropdown.style.display = 'none';
            if (searchTimeout) clearTimeout(searchTimeout);
            return;
        }

        clearBtn.style.display = 'flex';
        searchDropdown.style.display = 'block';
        searchDropdown.innerHTML = '<div class="search-no-results">Searching US stock markets...</div>';

        if (searchTimeout) clearTimeout(searchTimeout);
        
        searchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error('Search request failed');
                const results = await response.json();
                
                if (searchInput.value.trim() === query) {
                    renderSearchDropdown(results, query);
                }
            } catch (err) {
                console.error("Live search failed, falling back to local suggestions:", err);
                if (searchInput.value.trim() === query) {
                    const queryLower = query.toLowerCase();
                    const filtered = SUGGESTED_SYMBOLS.filter(sym => sym.toLowerCase().includes(queryLower));
                    renderSearchDropdownOffline(filtered, query);
                }
            }
        }, 250);
    });

    clearBtn.addEventListener('click', clearSearchUI);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchDropdown.style.display = 'none';
        }
    });

    // Tabs toggle
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetTab = btn.dataset.tab;
            document.querySelectorAll('.tab-panel').forEach(p => {
                if (p.id === targetTab) {
                    p.classList.add('active');
                } else {
                    p.classList.remove('active');
                }
            });

            // Re-render TradingView Chart if tab clicked
            if (targetTab === 'chart-tab' && activeStockSymbol && stockDetails[activeStockSymbol]) {
                renderTradingViewChart(stockDetails[activeStockSymbol]);
            }
            // Load earnings data if earnings tab clicked
            if (targetTab === 'earnings-tab' && activeStockSymbol) {
                renderEarningsTab(activeStockSymbol);
            }
            // Load economic indicators if tab clicked
            if (targetTab === 'indicators-tab') {
                renderEconomicIndicators();
            }
        });
    });

    // Chart Type Click Handlers (Line vs Candlestick)
    document.getElementById('btn-chart-line').addEventListener('click', () => {
        document.getElementById('btn-chart-line').classList.add('active');
        document.getElementById('btn-chart-candle').classList.remove('active');
        currentChartType = 'line';
        if (activeStockSymbol && stockDetails[activeStockSymbol]) {
            renderTradingViewChart(stockDetails[activeStockSymbol]);
        }
    });

    document.getElementById('btn-chart-candle').addEventListener('click', () => {
        document.getElementById('btn-chart-candle').classList.add('active');
        document.getElementById('btn-chart-line').classList.remove('active');
        currentChartType = 'candle';
        if (activeStockSymbol && stockDetails[activeStockSymbol]) {
            renderTradingViewChart(stockDetails[activeStockSymbol]);
        }
    });

    // Historical Range Click Handlers
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const range = btn.dataset.range;
            const interval = btn.dataset.interval;
            
            currentRange = range;
            currentInterval = interval;
            
            if (activeStockSymbol) {
                fetchAndDrawStock(activeStockSymbol, currentRange, currentInterval, true);
            }
        });
    });

    // Table View Toggle Click Handlers (Catalyst reasons vs 1Y Historical comparisons)
    document.getElementById('btn-table-catalysts').addEventListener('click', () => {
        document.getElementById('btn-table-catalysts').classList.add('active');
        document.getElementById('btn-table-compare').classList.remove('active');
        currentTableView = 'catalysts';
        if (activeStockSymbol && stockDetails[activeStockSymbol]) {
            renderPriceChangeHistory(stockDetails[activeStockSymbol]);
        }
    });

    document.getElementById('btn-table-compare').addEventListener('click', async () => {
        document.getElementById('btn-table-compare').classList.add('active');
        document.getElementById('btn-table-catalysts').classList.remove('active');
        currentTableView = 'compare';

        if (!activeStockSymbol) return;

        const stock = stockDetails[activeStockSymbol];
        if (!stock) return;

        // Check if we already have 2+ years of daily data (need ~500 bars for year-ago lookup)
        const hasEnoughHistory = stock.dailyHistory && stock.dailyHistory.length >= 400;

        if (hasEnoughHistory) {
            renderPriceChangeHistory(stock);
        } else {
            // Silently fetch 2 years of daily data to fill in the year-ago prices
            showToast('Loading 2-year history for comparison...', 'info');
            try {
                const data2y = await fetchStockFromAPI(activeStockSymbol, '2y', '1d');
                // Merge: keep chart history as-is, update dailyHistory with full 2-year set
                stock.dailyHistory = data2y.history;
                stockDetails[activeStockSymbol] = stock;
                saveToLocalStorage();
                renderPriceChangeHistory(stock);
            } catch (e) {
                // Fallback: render with what we have
                renderPriceChangeHistory(stock);
            }
        }
    });

    // Suggestion badges click in empty state
    document.querySelectorAll('.suggest-badge').forEach(badge => {
        badge.addEventListener('click', () => {
            addToWatchlist(badge.dataset.symbol);
        });
    });

    // Economic Indicators Tier Filters
    document.getElementById('btn-indicators-tier1').addEventListener('click', () => {
        document.getElementById('btn-indicators-tier1').classList.add('active');
        document.getElementById('btn-indicators-tier2').classList.remove('active');
        currentIndicatorTier = 'Tier 1 (Primary)';
        renderEconomicIndicators();
    });

    document.getElementById('btn-indicators-tier2').addEventListener('click', () => {
        document.getElementById('btn-indicators-tier2').classList.add('active');
        document.getElementById('btn-indicators-tier1').classList.remove('active');
        currentIndicatorTier = 'Tier 2 (Secondary)';
        renderEconomicIndicators();
    });
}

// 14. Render Dropdown search hits (Live Autocomplete Suggestions)
function renderSearchDropdown(results, query) {
    const dropdown = document.getElementById('search-results');
    dropdown.innerHTML = '';

    const cleanQuery = query.toUpperCase().trim();

    if (!results || results.length === 0) {
        // Offer force custom add option
        const noResults = document.createElement('div');
        noResults.className = 'search-no-results';
        noResults.textContent = `No matches found for "${cleanQuery}"`;
        dropdown.appendChild(noResults);

        if (cleanQuery.length >= 1 && cleanQuery.length <= 6 && /^[A-Z0-9.\-]+$/.test(cleanQuery)) {
            const wrapper = document.createElement('div');
            wrapper.className = 'search-custom-add';
            
            const btn = document.createElement('div');
            btn.className = 'search-add-custom-wrapper';
            btn.innerHTML = `
                <span class="search-add-custom-text">Force fetch custom ticker <strong>"${cleanQuery}"</strong></span>
                <span class="search-add-custom-btn">+ Add</span>
            `;
            
            btn.addEventListener('click', () => addToWatchlist(cleanQuery));
            wrapper.appendChild(btn);
            dropdown.appendChild(wrapper);
        }
        return;
    }

    results.forEach(stock => {
        const item = document.createElement('div');
        item.className = 'search-item';
        
        const isTracked = watchlist.includes(stock.symbol);
        
        item.innerHTML = `
            <div class="search-item-info">
                <span class="search-item-symbol">${stock.symbol}</span>
                <span class="search-item-name">${stock.name} (${stock.exchange || 'US Market'})</span>
            </div>
            <span class="search-item-add">${isTracked ? 'View' : '+ Watch'}</span>
        `;

        item.addEventListener('click', () => {
            addToWatchlist(stock.symbol);
        });

        dropdown.appendChild(item);
    });
}

// Fallback search renderer for offline/error states
function renderSearchDropdownOffline(symbols, query) {
    const dropdown = document.getElementById('search-results');
    dropdown.innerHTML = '';
    const cleanQuery = query.toUpperCase().trim();

    if (symbols.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'search-no-results';
        noResults.textContent = `No preset matches for "${cleanQuery}"`;
        dropdown.appendChild(noResults);
        return;
    }

    symbols.forEach(sym => {
        const item = document.createElement('div');
        item.className = 'search-item';
        const isTracked = watchlist.includes(sym);
        
        item.innerHTML = `
            <div class="search-item-info">
                <span class="search-item-symbol">${sym}</span>
                <span class="search-item-name">Predefined Symbol (Offline Mode)</span>
            </div>
            <span class="search-item-add">${isTracked ? 'View' : '+ Watch'}</span>
        `;
        
        item.addEventListener('click', () => addToWatchlist(sym));
        dropdown.appendChild(item);
    });
}

// 15. Toast Alert helper
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconName = type === 'success' ? 'check-circle' : 'info';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}" class="toast-icon"></i>
        <div class="toast-content">${message}</div>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4500);
}

// 16. Fluctuating Ticker Index values in header
function simulateIndexTickerFluctuations() {
    const indices = [
        { id: 'index-sp500', name: 'S&P 500', base: 5137.08 },
        { id: 'index-nasdaq', name: 'NASDAQ', base: 16274.94 },
        { id: 'index-dow', name: 'DOW JONES', base: 39087.38 },
        { id: 'index-russell', name: 'RUSSELL 2000', base: 2055.48 }
    ];

    setInterval(() => {
        const indexIdx = Math.floor(Math.random() * indices.length);
        const indexObj = indices[indexIdx];
        const card = document.getElementById(indexObj.id);
        if (!card) return;

        const deltaPct = (Math.random() * 0.08 - 0.04);
        indexObj.base = +(indexObj.base * (1 + deltaPct / 100)).toFixed(2);

        const netChangePct = +(deltaPct * 3.5 + (indexIdx % 2 === 0 ? 0.35 : -0.15)).toFixed(2);
        const sign = netChangePct >= 0 ? '+' : '';

        const valSpan = card.querySelector('.ticker-value');
        if (valSpan) valSpan.textContent = indexObj.base.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const trendDiv = card.querySelector('.ticker-trend');
        if (trendDiv) {
            trendDiv.className = `ticker-trend ${netChangePct >= 0 ? 'trend-up' : 'trend-down'}`;
            const trendIcon = netChangePct >= 0 ? 'trending-up' : 'trending-down';
            trendDiv.innerHTML = `<i data-lucide="${trendIcon}"></i><span>${sign}${netChangePct}%</span>`;
        }
        
        lucide.createIcons();
    }, 8000);
}
