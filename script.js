let state = {
    tasks: [],
    timeScales: [],
    agenda: [] 
}

function Load() {
    let savedTimeScales = localStorage.getItem("timeScales")

    let todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    state.timeScales = savedTimeScales ? JSON.parse(savedTimeScales) : [
        {
            id: "daily",
            name: "Daily",
            duration: 1,
            start: todayMidnight.toISOString()
        },
    ]

    let savedTasks = localStorage.getItem("tasks")
    state.tasks = savedTasks ? JSON.parse(savedTasks) : []

    let savedAgenda = localStorage.getItem("agenda")
    let parsedAgenda = savedAgenda ? JSON.parse(savedAgenda) : []
    
    state.agenda = parsedAgenda.map(item => {
        if (typeof item === 'number') return new Date(item).toISOString();
        if (typeof item === 'string' && item.includes('-') && !item.includes('T')) return null; 
        return item;
    }).filter(Boolean);
}

function Save() {
    localStorage.setItem("timeScales", JSON.stringify(state.timeScales))

    let tasksToSave = state.tasks.map((task)=>{
        return {
            ...task,
            running: false
        }
    })
    localStorage.setItem("tasks", JSON.stringify(tasksToSave))
    localStorage.setItem("agenda", JSON.stringify(state.agenda))
}


let dingQueue = [];
let isDinging = false;

function processDingQueue() {
    if (dingQueue.length === 0) {
        isDinging = false;
        return;
    }
    isDinging = true;
    
    const n = dingQueue.shift();
    
    for (let i = 0; i < n; i++) {
        setTimeout(() => {
            const audio = new Audio('ding.mp3');
            audio.play();
        }, i * 500);
    }
    
    
    setTimeout(processDingQueue, (n * 500) + 800);
}

function ding(n){
    dingQueue.push(n);
    if (!isDinging) {
        processDingQueue();
    }
}

function ring(){
    const audio = new Audio('ring.mp3');
    audio.play();
}


function createNewTask(){
    let times = {}
    state.timeScales.forEach((scale)=>{
        times[scale.id] = {
            elapsed: 0,
            goal: 3600
        }
    });

    state.tasks.push(
        {
            id : crypto.randomUUID(),
            name: "New Task",
            times: times,
            running: false
        }
    )
    Save()
    RenderTasks()
    RenderTimeScales()
}

let interval;
let startTime;
let startCounters;

function toggleTask(id, UITarget){
    let task = state.tasks.find((task)=>task.id === id)
    clearInterval(interval);
    if (task.running) {
        task.running = false
        RenderTasks()
    } else {
        state.tasks.forEach((task)=>{
            task.running = false
        })
        task.running = true
        startTime = new Date().getTime()
        startCounters = JSON.parse(JSON.stringify(task.times))

        RenderTasks()
        RenderTimeScales()

        interval = setInterval(()=>{
            let elapsedTime = (new Date().getTime() - startTime) / 1000

            
            const wasAllCompleted = state.timeScales.every(scale =>
                task.times[scale.id].elapsed >= task.times[scale.id].goal
            );

            const prevScaleCompletion = {};
            state.timeScales.forEach(scale => {
                const totals = state.tasks.reduce((acc, t) => {
                    acc.elapsed += Math.min(Number(t.times[scale.id]?.elapsed) || 0, Number(t.times[scale.id]?.goal) || 0);
                    acc.goal += Number(t.times[scale.id]?.goal) || 0;
                    return acc;
                }, { elapsed: 0, goal: 0 });
                prevScaleCompletion[scale.id] = totals.goal > 0 && totals.elapsed >= totals.goal;
                
            });

            
            let anyCrossed = false;
            state.timeScales.forEach(scale => {
                const newElapsed = Math.round(startCounters[scale.id].elapsed + elapsedTime);

                if (task.times[scale.id].elapsed < task.times[scale.id].goal && newElapsed >= task.times[scale.id].goal) {
                    anyCrossed = true;
                }

                task.times[scale.id].elapsed = newElapsed;
            });

            
            const isAllCompleted = state.timeScales.every(scale =>
                task.times[scale.id].elapsed >= task.times[scale.id].goal
            );

            let scaleFinished = false;
            state.timeScales.forEach(scale => {
                const totals = state.tasks.reduce((acc, t) => {
                    acc.elapsed += Math.min(Number(t.times[scale.id]?.elapsed) || 0, Number(t.times[scale.id]?.goal) || 0);
                    acc.goal += Number(t.times[scale.id]?.goal) || 0;
                    return acc;
                }, { elapsed: 0, goal: 0 });

                const isCompleted = totals.goal > 0 && totals.elapsed >= totals.goal;
                if (isCompleted && !prevScaleCompletion[scale.id]) {
                    scaleFinished = true;
                }
            });

            
            if (anyCrossed) {
                ding(1);
            }
            if (isAllCompleted && !wasAllCompleted) {
                ding(2);
            }
            if (scaleFinished) {
                ding(3);
            }

            
            state.timeScales.forEach((scale)=>{
                if (new Date(scale.start).getTime() + scale.duration * 24 * 60 * 60 * 1000 < new Date().getTime()) {
                    scale.start = new Date().toISOString()
                    state.tasks.forEach((task)=>{
                        task.times[scale.id].elapsed = 0
                    })

                    if (task.running) {
                        startTime = new Date().getTime();
                        startCounters = JSON.parse(JSON.stringify(task.times));
                    }
                }
            })

            RenderTasks()
            RenderTimeScales()
            Save()
        }, 1000)
    }
}

function editTask(id) {
    let task = state.tasks.find((task) => task.id === id);
    document.getElementById("modal-title").innerText = "Edit Task";
    
    document.getElementById("modal-body").innerHTML = `
        <div class="form-group">
            <label>Name <span style="color:red">*</span></label>
            <input type="text" id="modal-taskName" value="${task.name}">
        </div>
        ${
            state.timeScales.map((scale) => {
                const totalSecs = task.times[scale.id].goal || 0;
                const h = Math.floor(totalSecs / 3600);
                const m = Math.floor((totalSecs % 3600) / 60);
                const s = totalSecs % 60;

                return `
                    <div class="form-group">
                        <label>${scale.name} goal <span style="color:red">*</span></label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" id="modal-task-${scale.id}-h" value="${h}" min="0" placeholder="HH" style="width: 70px;"> hrs
                            <input type="number" id="modal-task-${scale.id}-m" value="${m}" min="0" max="59" placeholder="MM" style="width: 70px;"> mins
                            <input type="number" id="modal-task-${scale.id}-s" value="${s}" min="0" max="59" placeholder="SS" style="width: 70px;"> secs
                        </div>
                    </div>
                `;
            }).join("")
        }
    `;
    
    document.getElementById("btn-submit").innerText = "Save Changes";
    document.getElementById("btn-submit").onclick = function() {
        const newName = document.getElementById("modal-taskName").value;

        if (!newName) {
            alert("Invalid input. Please try again.");
            return;
        }
        
        task.name = newName;
        
        try {
            task.times = state.timeScales.reduce((acc, scale) => {
                const h = parseInt(document.getElementById(`modal-task-${scale.id}-h`).value) || 0;
                const m = parseInt(document.getElementById(`modal-task-${scale.id}-m`).value) || 0;
                const s = parseInt(document.getElementById(`modal-task-${scale.id}-s`).value) || 0;

                if (h < 0 || m < 0 || s < 0) {
                    throw new Error("Time values cannot be negative.");
                }

                const newGoal = (h * 3600) + (m * 60) + s;

                acc[scale.id] = {
                    ...task.times[scale.id],
                    goal: newGoal
                };
                return acc;
            }, {});
        } catch (error) {
            alert("Invalid time input. Please check your values and try again.");
            return;
        }

        Save();
        RenderTasks();
        RenderTimeScales();
        closeModal("modal");
    }
    
    openModal("modal");
}

function RenderTasks() {
    const container = document.getElementById("root-tasks");
    container.innerHTML = `
        <h3>To-do List</h3>
        <div id="task-list-container">
            <div class="task" style="text-align: center; cursor: pointer;" onclick="createNewTask()">+ New Task</div>
            ${
                state.tasks.map((task)=>{
                    return `
                        <div class="task ${task.running ? "active" : ""}" style="cursor: pointer;" onclick="if (event.target.classList.contains('edit-icon')) { return; } toggleTask('${task.id}', this)">
                            <div class="task-main-content">
                                <div class="task-title-row">
                                    <h3 class="task-title">${task.name}</h3>
                                    <div class="task-actions edit-icon" onclick="editTask('${task.id}')">⚙</div>
                                </div>
                                <div class="task-progress-list">
                                    ${state.timeScales.map((scale)=>{
                                        const progress = task.times[scale.id].goal > 0
                                            ? Math.min(100, (task.times[scale.id].elapsed / task.times[scale.id].goal) * 100)
                                            : 0;
                                        return `
                                            <div class="task-progress-row">
                                                <div class="task-progress-meta">
                                                    <span>${scale.name}</span>
                                                    <span>${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(task.times[scale.id].goal * 1000).toISOString().substring(11, 19)}</span>
                                                </div>
                                                <div class="progress-bar task-progress-bar">
                                                    <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                                                </div>
                                            </div>
                                        `
                                    }).join("")}
                                </div>
                            </div>
                        </div>
                    `
                }).join("")
            }
        </div>
    `
}

function addTimeScale() {
    const name = prompt("Enter the name of the new time scale:");
    const duration = parseInt(prompt("Enter the duration of the new time scale in days:"));

    if (name && !isNaN(duration)) {
        let dateTemp = new Date();
        dateTemp.setUTCHours(0, 0, 0, 0);
        const newScale = {
            id: crypto.randomUUID(),
            name: name,
            duration: duration,
            start: dateTemp.toDateString()
        };
        state.timeScales.push(newScale);

        let runningTask = null;

        state.tasks.forEach((task) => {
            task.times[newScale.id] = {
                elapsed: 0,
                goal: 3600
            };
            if (task.running) {
                runningTask = task;
            }
        });

        if (runningTask) {
            startTime = new Date().getTime();
            startCounters = JSON.parse(JSON.stringify(runningTask.times));
        }

        Save();
        RenderTimeScales();
        RenderTasks();
        RenderAgenda();

    } else {
        alert("Invalid input. Please try again.");
    }
}

function editTimeScale(id) {
    const scale = state.timeScales.find((scale) => scale.id === id);
    document.getElementById("modal-title").innerText = "Edit Time Scale";
    document.getElementById("modal-body").innerHTML = `
        <div class="form-group ">
            <label>Name <span style="color:red">*</span></label>
            <input type="text" id="modal-timeScaleName" value="${scale.name}">
        </div>
        <div class="form-group ">
            <label>Duration (in days) <span style="color:red">*</span></label>
            <input type="number" id="modal-timeScaleDuration" value="${scale.duration}">
        </div>
    `;
    document.getElementById("btn-submit").innerText = "Save Changes";
    document.getElementById("btn-submit").onclick = function() {
        const newName = document.getElementById("modal-timeScaleName").value;
        const newDuration = parseInt(document.getElementById("modal-timeScaleDuration").value);
        if (newName && !isNaN(newDuration)) {
            scale.name = newName;
            scale.duration = newDuration;
            Save();
            RenderTimeScales();
            closeModal("modal");
        } else {
            alert("Invalid input. Please try again.");
        }
    }
    openModal("modal");
}

function RenderTimeScales(agendaData = state.agenda) {
    const container = document.getElementById("root-time-scales");
    container.innerHTML = `
        <h3>Time Scales</h3>
        <div id="time-scale-list-container">
            <div class="time-scale" style="text-align: center; cursor: pointer;" onclick="addTimeScale()">+ New Time Scale</div>
            ${state.timeScales.map((scale)=>{
                const totals = state.tasks.reduce((acc, task) => {
                    acc.elapsed += Math.min(Number(task.times[scale.id]?.elapsed) || 0, Number(task.times[scale.id]?.goal) || 0); 
                    acc.goal += Number(task.times[scale.id]?.goal) || 0;
                    return acc;
                }, { elapsed: 0, goal: 0 });

                const taskPercentage = totals.goal > 0
                    ? Math.min(100, (totals.elapsed / totals.goal) * 100)
                    : 100;

                const currentTime = Date.now();
                const startTimeMs = new Date(scale.start).getTime() || currentTime;
                const durationDays = Number(scale.duration) || 0;

                const rawTotalTimeMs = durationDays * 24 * 60 * 60 * 1000;
                const slotDurationMs = 15 * 60 * 1000; 

                let totalExcludedTimeMs = 0;
                let passedExcludedTimeMs = 0;

                agendaData.forEach(blockStartIso => {
                    const blockStartMs = new Date(blockStartIso).getTime();
                    const blockEndMs = blockStartMs + slotDurationMs;
                    const scaleEndMs = startTimeMs + rawTotalTimeMs;

                    if (blockStartMs >= startTimeMs && blockStartMs < scaleEndMs) {
                        totalExcludedTimeMs += slotDurationMs;

                        if (currentTime >= blockEndMs) {
                            passedExcludedTimeMs += slotDurationMs;
                        } else if (currentTime > blockStartMs && currentTime < blockEndMs) {
                            passedExcludedTimeMs += (currentTime - blockStartMs);
                        }
                    }
                });

                const totalTimeMs = rawTotalTimeMs - totalExcludedTimeMs;
                const rawTimeUsed = currentTime - startTimeMs;
                const timeUsed = rawTimeUsed - passedExcludedTimeMs;

                const timeRemaining = totalTimeMs - timeUsed;
                const taskRemaining = totals.goal - totals.elapsed;

                if (taskRemaining > 0 && (timeRemaining - taskRemaining) <= 5 * 60 * 1000) { // ring if the user should start working within the next 5 minutes
                    if (!scale.hasRung) { 
                        ring();
                        document.getElementById("modal-title").innerText = "Time Alert";
                        document.getElementById("modal-body").innerHTML = `
                            <p>Time to start working on tasks for the "${scale.name}" time scale!</p>
                        `;
                        document.getElementById("btn-submit").innerText = "I'll start working!";
                        document.getElementById("btn-submit").onclick = function() {
                            closeModal("modal");
                        }
                        openModal("modal")
                        scale.hasRung = true; 
                    }
                } else {
                    scale.hasRung = false; 
                }

                const timePercentage = (totalTimeMs > 0 && !isNaN(timeUsed))
                    ? Math.max(0, Math.min(100, (timeUsed / totalTimeMs) * 100))
                    : 0;

                return `
                    <div class="time-scale">
                        <div class="time-scale-header">
                            <h3>${scale.name}</h3>
                            <div onclick="editTimeScale('${scale.id}')" class="edit-icon">⚙</div>
                        </div>
                        <div>Duration: ${scale.duration} day${scale.duration !== 1 ? "s" : ""}</div>
                        <div>
                            <div>Start: ${new Date(scale.start).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</div>
                            <div>End: ${new Date(new Date(scale.start).getTime() + scale.duration * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</div>
                        </div>
                        <div class="time-scale-progress-section">
                            <div class="time-scale-progress-block">
                                <div class="time-scale-progress-meta">
                                    <span>Tasks</span>
                                    <span>${new Date(totals.elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(totals.goal * 1000).toISOString().substring(11, 19)}</span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-bar-fill" style="width: ${taskPercentage}%;"></div>
                                </div>
                            </div>
                            <div class="time-scale-progress-block">
                                <div class="time-scale-progress-meta">
                                    <span>Time</span>
                                    <span>${timePercentage.toFixed(1)}%</span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-bar-fill" style="width: ${timePercentage}%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `
            }).join("")}
        </div>
    `
}

function resetTimes(){
    let dateTemp = new Date();
    dateTemp.setUTCHours(0, 0, 0, 0);
    state.timeScales.forEach((scale)=>{
        scale.start = dateTemp.toISOString()
    })

    let runningTask = null;

    state.tasks.forEach((task)=>{
        Object.keys(task.times).forEach((scaleId)=>{
            task.times[scaleId].elapsed = 0
        })

        if (task.running) {
            runningTask = task;
        }
    })

    if (runningTask) {
        startTime = new Date().getTime();
        startCounters = JSON.parse(JSON.stringify(runningTask.times));
    } else {
        startCounters = null;
    }

    Save()
    RenderTasks()
    RenderTimeScales()
}

function RenderAgenda() { 
    const container = document.getElementById("root-agenda");
    
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    
    const getTimestamp = (dayOffset, timeOffset) => {
        return baseDate.getTime() + (dayOffset * 24 * 60 * 60 * 1000) + (timeOffset * 15 * 60 * 1000);
    };

    container.innerHTML = `
        <h3>Agenda</h3>
        <table id="agenda-table" style="user-select: none;">
            ${(() => {
                const longestScale = state.timeScales.reduce((max, scale) => Math.max(max, scale.duration), 0);
                const rows = [];
                const headerCells = [`<th class="agenda-top-left-empty"></th>`];

                for (let j = 0; j < longestScale; j++) {
                    const currentDate = new Date(baseDate.getTime() + j * 24 * 60 * 60 * 1000);
                    const dateString = currentDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
                    headerCells.push(`<th class="agenda-date-header" style="font-weight: bold;">${dateString}</th>`);
                }
                rows.push(`<tr>${headerCells.join('')}</tr>`);

                for (let i = 0; i < 24 * 4; i++) {
                    const isFullHour = i % 4 === 0;
                    const timeLabel = new Date(0, 0, 0, Math.floor(i / 4), (i % 4) * 15)
                        .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

                    const labelContent = isFullHour ? timeLabel : '';
                    const rowCells = [`<td class="agenda-time-label${isFullHour ? ' agenda-time-label-full-hour' : ''}" style="font-weight: 700; text-align: center;">${labelContent}</td>`];

                    for (let j = 0; j < longestScale; j++) {
                        const ts = getTimestamp(j, i);
                        const isoString = new Date(ts).toISOString();
                        const isSelected = state.agenda.includes(isoString);
                        const bgColor = isSelected ? 'lightcoral' : 'transparent';
                        
                        rowCells.push(`<td class="agenda-cell" data-day="${j}" data-time="${i}" data-iso="${isoString}" style="background-color: ${bgColor}; border: 1px solid black; border-top: ${isFullHour ? '3' : '1'}px solid black; min-width: 40px;"></td>`);
                    }
                    rows.push(`<tr>${rowCells.join('')}</tr>`);
                }
                return rows.join('');
            })()}
        </table>
    `;

    const table = document.getElementById("agenda-table");
    let isDragging = false;
    let isSelecting = true;
    let startCoords = null;
    let currentCoords = null;

    const parseCoords = (cell) => {
        return {
            day: parseInt(cell.getAttribute("data-day")),
            time: parseInt(cell.getAttribute("data-time")),
            iso: cell.getAttribute("data-iso")
        };
    };

    const updatePreview = () => {
        if (!startCoords || !currentCoords) return;

        const minDay = Math.min(startCoords.day, currentCoords.day);
        const maxDay = Math.max(startCoords.day, currentCoords.day);
        const minTime = Math.min(startCoords.time, currentCoords.time);
        const maxTime = Math.max(startCoords.time, currentCoords.time);

        document.querySelectorAll('.agenda-cell').forEach(cell => {
            const coords = parseCoords(cell);
            const isInState = state.agenda.includes(coords.iso);

            const inBox = (coords.day >= minDay && coords.day <= maxDay &&
                           coords.time >= minTime && coords.time <= maxTime);

            if (inBox) {
                cell.style.backgroundColor = isSelecting ? "lightcoral" : "transparent";
            } else {
                cell.style.backgroundColor = isInState ? "lightcoral" : "transparent";
            }
        });
    };

    table.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "TD" && e.target.classList.contains("agenda-cell")) {
            isDragging = true;
            startCoords = parseCoords(e.target);
            currentCoords = startCoords;
            isSelecting = !state.agenda.includes(startCoords.iso);

            updatePreview();
            RenderTimeScales();
        }
    });

    table.addEventListener("mouseover", (e) => {
        if (isDragging && e.target.tagName === "TD" && e.target.classList.contains("agenda-cell")) {
            currentCoords = parseCoords(e.target);
            updatePreview();

            const minDay = Math.min(startCoords.day, currentCoords.day);
            const maxDay = Math.max(startCoords.day, currentCoords.day);
            const minTime = Math.min(startCoords.time, currentCoords.time);
            const maxTime = Math.max(startCoords.time, currentCoords.time);

            let tempAgenda = [...state.agenda];

            for (let d = minDay; d <= maxDay; d++) {
                for (let t = minTime; t <= maxTime; t++) {
                    const isoString = new Date(getTimestamp(d, t)).toISOString();
                    if (isSelecting && !tempAgenda.includes(isoString)) {
                        tempAgenda.push(isoString);
                    } else if (!isSelecting && tempAgenda.includes(isoString)) {
                        tempAgenda = tempAgenda.filter(item => item !== isoString);
                    }
                }
            }
            RenderTimeScales(tempAgenda);
        }
    });

    if (window.agendaMouseUpHandler) {
        document.removeEventListener("mouseup", window.agendaMouseUpHandler);
    }

    window.agendaMouseUpHandler = () => {
        if (isDragging && startCoords && currentCoords) {
            isDragging = false;

            const minDay = Math.min(startCoords.day, currentCoords.day);
            const maxDay = Math.max(startCoords.day, currentCoords.day);
            const minTime = Math.min(startCoords.time, currentCoords.time);
            const maxTime = Math.max(startCoords.time, currentCoords.time);

            for (let d = minDay; d <= maxDay; d++) {
                for (let t = minTime; t <= maxTime; t++) {
                    const isoString = new Date(getTimestamp(d, t)).toISOString();
                    if (isSelecting) {
                        if (!state.agenda.includes(isoString)) state.agenda.push(isoString);
                    } else {
                        const index = state.agenda.indexOf(isoString);
                        if (index > -1) state.agenda.splice(index, 1);
                    }
                }
            }

            startCoords = null;
            currentCoords = null;
            Save();
            RenderTimeScales(); 
        }
    };

    document.addEventListener("mouseup", window.agendaMouseUpHandler);
}

openModal = (id) => document.getElementById(id).classList.add('active');
closeModal = (id) => document.getElementById(id).classList.remove('active');

Load()
RenderTasks()
RenderTimeScales()
RenderAgenda()