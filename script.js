let state = {
    tasks: [],
    timeScales: [],
    agenda: [],
    statistics: []
}

function Load() {
    let savedTimeScales = localStorage.getItem("timeScales")

    let todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    state.timeScales = savedTimeScales ? JSON.parse(savedTimeScales) : [
        {
            id: crypto.randomUUID(),
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
        if (typeof item === 'number') {
            return { iso: new Date(item).toISOString(), busy: true };
        }
        if (typeof item === 'string') {
            if (item.includes('-') && !item.includes('T')) return null; 
            return { iso: item, busy:true };
        }
        if (typeof item === 'object' && item !== null && item.iso) {
            return item;
        }
        return null;
    }).filter(Boolean);

    let savedStats = localStorage.getItem("statistics");
    state.statistics = savedStats ? JSON.parse(savedStats) : [];
}

function Save() {
    localStorage.setItem("timeScales", JSON.stringify(state.timeScales));

    let tasksToSave = state.tasks.map((task) => {
        let cleanSubtasks = task.subtasks.map((subtask) => {
            let { deleteTimeout, ...cleanSubtask } = subtask;
            return cleanSubtask;
        });

        return {
            ...task,
            running: false,
            subtasks: cleanSubtasks
        };
    });
    
    localStorage.setItem("tasks", JSON.stringify(tasksToSave));

    const earliestStart = state.timeScales.reduce((min, scale) => {
        const scaleStart = new Date(scale.start).getTime();
        return scaleStart < min ? scaleStart : min;
    }, Infinity);

    // remove uselless agenda items
    state.agenda = state.agenda.filter((item) => {
        const itemTime = new Date(item.iso).getTime();
        const hasData = item.busy || item.tasksWorked;
        const isAfterStart = itemTime >= (earliestStart - 2 * 86400); // two day padding
        
        return hasData && isAfterStart;
    });

    localStorage.setItem("agenda", JSON.stringify(state.agenda));
    localStorage.setItem("statistics", JSON.stringify(state.statistics));
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
        }, i * 300);
    }
    
    setTimeout(processDingQueue, (n * 300) + 1500);
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
            running: false,
            subtasks: []
        }
    )
    Save()
    RenderTasks()
    RenderTimeScales()
}

function getCurrentAgendaSlot() {
    let now = new Date();
    let minutes = Math.floor(now.getMinutes() / 15) * 15;
    let slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), minutes, 0, 0);
    return slot.toISOString();
}

const timerWorker = new window.Worker('timerWorker.js');
let startTime;
let startCounters;
let lastTime;
let deltaTime = 0;

function toggleTask(id, UITarget) {
    let task = state.tasks.find((task) => task.id === id);
    
    
    timerWorker.postMessage('stop'); 
    
    if (task.running) {
        task.running = false;
        UpdateTasksRender();
    } else {
        state.tasks.forEach((task) => {
            task.running = false;
        });
        task.running = true;
        startTime = new Date().getTime();
        startCounters = JSON.parse(JSON.stringify(task.times));
        lastTime = new Date().getTime();

        UpdateTasksRender();
        UpdateTimeScalesRender();

        timerWorker.onmessage = function(e) {
            if (e.data === 'tick') {
                let now = new Date().getTime();
                let elapsedTime = (now - startTime) / 1000;
                
                deltaTime = now - lastTime;
                lastTime = now;
                
                let timeRemaining = deltaTime; // ms
                let timeMarker = now;

                while (timeRemaining > 0) {
                    let markerDate = new Date(timeMarker);
                    let minutes = Math.floor(markerDate.getMinutes() / 15) * 15;
                    let slotStart = new Date(markerDate.getFullYear(), markerDate.getMonth(), markerDate.getDate(), markerDate.getHours(), minutes, 0, 0);
                    let slotStartTime = slotStart.getTime();
                    
                    let timeInThisSlot;

                    if (timeMarker === slotStartTime) {
                        timeMarker -= 1;
                        continue; 
                    } else {
                        timeInThisSlot = Math.min(timeRemaining, timeMarker - slotStartTime);
                    }
                    
                    let currentSlotIso = slotStart.toISOString();
                    let agendaBlock = state.agenda.find(item => item.iso === currentSlotIso);

                    if (!agendaBlock) {
                        agendaBlock = { iso: currentSlotIso, busy: false, tasksWorked: {} };
                        state.agenda.push(agendaBlock);
                    }

                    if (!agendaBlock.tasksWorked) {
                        agendaBlock.tasksWorked = {};
                    }
                    
                    let timeInThisSlotSeconds = timeInThisSlot / 1000;
                    agendaBlock.tasksWorked[task.id] = (agendaBlock.tasksWorked[task.id] || 0) + timeInThisSlotSeconds;

                    timeMarker -= timeInThisSlot;
                    timeRemaining -= timeInThisSlot;

                    updatePreview();
                }

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

                UpdateTasksRender();
                Save();
            }
        };

        timerWorker.postMessage('start');
    }
}

function moveTaskUp(id) {
    const index = state.tasks.findIndex(task => task.id === id);
    
    if (index > 0) {
        const taskToMove = state.tasks.splice(index, 1)[0];
        state.tasks.splice(index - 1, 0, taskToMove);
        
        Save();
        RenderTasks();
    }
}

function editTask(id) {
    let task = state.tasks.find((task) => task.id === id);
    let taskIndex = state.tasks.findIndex((task) => task.id === id);
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

    const moveUpButtonHTML = taskIndex > 0 
        ? `<button class="btn btn-secondary" id="move-up-button" onclick="moveTaskUp('${task.id}')" style="margin-right: 5px;">Move Up</button>` 
        : '';

    document.getElementById('btn-submit').insertAdjacentHTML('beforebegin', `
        ${moveUpButtonHTML}
        <button class="btn btn-danger" id="delete-button" onclick="deleteTask('${task.id}')" style="margin-right: 5px;">Delete</button>
    `);

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

function deleteTask(id) {
    const index = state.tasks.findIndex(task => task.id === id);
    
    if (index !== -1 && window.confirm(`Are you sure you want to delete "${state.tasks[index].name}"`)) {
        state.tasks.splice(index, 1);
    }
    Save();
    RenderTimeScales();
    RenderTasks();
    RenderAgenda();
    
    closeModal("modal")
}

function createNewSubtask(id) {
    let task = state.tasks.find((task) => task.id === id);
    let subtaskName = prompt("What do you need to do?");
    
    if (subtaskName && subtaskName.trim() !== "") {
        task.subtasks.push({ name: subtaskName, done: false });
        Save();
        RenderTasks();
    }
}

function toggleSubtask(taskId, subtaskIndex) {
    let task = state.tasks.find((task) => task.id === taskId);
    let subtask = task.subtasks[subtaskIndex];

    subtask.done = !subtask.done;

    if (subtask.done) {
        subtask.deleteTimeout = setTimeout(() => {
            const currentIndex = task.subtasks.indexOf(subtask);
            if (currentIndex > -1) {
                deleteSubtask(taskId, currentIndex);
            }
        }, 5000);
    } else {
        clearTimeout(subtask.deleteTimeout);
    }
    
    Save();
    RenderTasks();
}

function deleteSubtask(taskId, subtaskIndex) {
    let task = state.tasks.find((task) => task.id === taskId);
    task.subtasks.splice(subtaskIndex, 1);
    
    Save();
    RenderTasks();
}

function RenderTasks() {
    const container = document.getElementById("root-tasks");
    let firstRender = false;
    if (container.innerHTML == '') firstRender = true;
    container.innerHTML = `
        <h3>To-do List</h3>
        <div id="task-list-container">
            <div class="task" style="text-align: center; cursor: pointer;" onclick="createNewTask()">+ New Task</div>
            ${
                state.tasks.map((task)=>{
                    return `
                        <div class="task ${task.running ? "active" : ""}" style="cursor: pointer;" onclick="if (event.target.classList.contains('edit-icon') || event.target.closest('.subtask-area')) { return; } toggleTask('${task.id}', this)">
                            <div class="task-main-content">
                                <div class="task-title-row">
                                    <h3 class="task-title">${task.name}</h3>
                                    <div class="task-actions edit-icon" onclick="editTask('${task.id}')">⚙</div>
                                </div>
                                <div class="subtask-area" style="margin: 15px 0;">
                                    <div class="task" style="text-align: center; cursor: pointer; padding: 5px; font-size: 0.9em; margin-bottom: 10px;" onclick="createNewSubtask('${task.id}')">+ New subtask</div>
                                    ${task.subtasks.map((subtask, index)=>{
                                        let name = typeof subtask === 'string' ? subtask : subtask.name;
                                        let isChecked = subtask.done ? 'checked' : '';
                                        let textStyle = subtask.done ? 'text-decoration: line-through; opacity: 0.6;' : '';
                                        let classname = subtask.done ? "task subtask-done" : "task";
                                        
                                        return `<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;" class="${classname}">
                                             <input type="checkbox" ${isChecked} onclick="toggleSubtask('${task.id}', ${index})"> 
                                             <span style="font-weight: 500; ${textStyle}">${name}</span>
                                             
                                        </div>`
                                    }).join("")}
                                </div>
                                <div class="task-progress-list">
                                    ${state.timeScales.map((scale)=>{
                                        if (task.times[scale.id].goal <= 0) return "";
                                        const progress = !firstRender
                                            ? (task.times[scale.id].elapsed / task.times[scale.id].goal) * 100
                                            : 0;
                                        if (firstRender) console.log(progress)
                                        return `
                                            <div class="task-progress-row">
                                                <div class="task-progress-meta">
                                                    <span>${scale.name}</span>
                                                    <span>${progress.toFixed(1)}%</span>
                                                    <span>${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(task.times[scale.id].goal * 1000).toISOString().substring(11, 19)} (${new Date(Math.max(0, task.times[scale.id].goal - task.times[scale.id].elapsed) * 1000).toISOString().substring(11, 19)} left)</span>
                                                </div>
                                                <div class="progress-bar task-progress-bar">
                                                    <div class="progress-bar-fill" style="width: ${Math.min(progress, 100)}%;"></div>
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
    if (firstRender){
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                UpdateTasksRender();
            });
        });
    }
}

function UpdateTasksRender() {
    const taskContainers = document.querySelectorAll("#task-list-container > .task:not([onclick='createNewTask()'])");
    
    taskContainers.forEach((taskContainer, index) => {
        let task = state.tasks[index];
        if (!task) return;

        if (task.running) {
            taskContainer.classList.add("active");
        } else {
            taskContainer.classList.remove("active");
        }

        let progressRows = taskContainer.querySelectorAll(".task-progress-row");
        progressRows.forEach((row, scaleIndex) => {
            let scale = state.timeScales[scaleIndex];
            if (!scale) return;

            const progress = task.times[scale.id].goal > 0
                ? (task.times[scale.id].elapsed / task.times[scale.id].goal) * 100
                : 0;

            let metaSpans = row.querySelectorAll(".task-progress-meta span");
            if (metaSpans.length >= 3) {
                metaSpans[1].textContent = `${progress.toFixed(1)}%`;
                metaSpans[2].textContent = `${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(task.times[scale.id].goal * 1000).toISOString().substring(11, 19)} (${new Date(Math.max(0, task.times[scale.id].goal - task.times[scale.id].elapsed) * 1000).toISOString().substring(11, 19)} left)`;
            }

            let progressBarFill = row.querySelector(".progress-bar-fill");
            if (progressBarFill) {
                progressBarFill.style.width = `${Math.min(100, progress)}%`;
            }
        });
    });
}

function addTimeScale() {
    
        let dateTemp = new Date();
        dateTemp.setHours(0, 0, 0, 0);
        const newScale = {
            id: crypto.randomUUID(),
            name: "New time scale",
            duration: 1,
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
        <div class="form-group ">
            <label>Start Date <span style="color:red">*</span></label>
            <input type="date" id="modal-timeScaleStart" value="${new Date(new Date(scale.start) - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]}">
        </div>
    `;
    document.getElementById('btn-submit').insertAdjacentHTML('beforebegin', `<button class="btn btn-danger" id="delete-button" onclick="deleteTimeScale('${scale.id}')">Delete</button>`);

    document.getElementById("btn-submit").innerText = "Save Changes";
    document.getElementById("btn-submit").onclick = function() {
        const newName = document.getElementById("modal-timeScaleName").value;
        const newDuration = parseInt(document.getElementById("modal-timeScaleDuration").value);
        const newStart = document.getElementById("modal-timeScaleStart").value;
        if (newName && !isNaN(newDuration) && newStart) {
            scale.name = newName;
            scale.duration = newDuration;

            let localDate = new Date(newStart + "T00:00:00"); 
            scale.start = localDate.toISOString();
            
            Save();
            RenderTimeScales();
            RenderTasks()
            RenderAgenda()
            closeModal("modal");
        } else {
            alert("Invalid input. Please try again.");
        }
    }

    openModal("modal");
}

function deleteTimeScale(id) {
    const index = state.timeScales.findIndex(scale => scale.id === id);
    
    if (index !== -1 && window.confirm(`Are you sure you want to delete "${state.timeScales[index].name}"`)) {
        state.timeScales.splice(index, 1);
        
        state.tasks.forEach(task => {
            if (task.times && task.times[id]) {
                delete task.times[id];
            }
        });
    }
    
    Save();
    RenderTimeScales();
    RenderTasks();
    RenderAgenda();
    
    closeModal("modal");
}

function formatDuration(ms) {
    
    let output = ms < 0 ? "-" : ""

    const totalSeconds = Math.floor(ms / 1000);
    
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (days > 0) {
        
        output += `${days.toString().padStart(2, "0")}:${formattedTime}`;
    }
    else{
        output = formattedTime
    }
    
    return output;
}

function getTimeScaleStreak(scaleId) {
    const scaleStats = state.statistics
        .filter(stat => stat.scaleId === scaleId)
        .reverse();

    let streakInDays = 0;

    for (const stat of scaleStats) {
        const cappedTotalWorked = stat.tasks.reduce((sum, task) => {
            return sum + Math.min(Number(task.elapsed) || 0, Number(task.goal) || 0);
        }, 0);

        const isCompleted = stat.goal === 0 || cappedTotalWorked >= stat.goal;

        if (isCompleted) {
            streakInDays += stat.duration;
        } else {
            break; 
        }
    }

    return streakInDays;
}


let isEditingAgenda = false;

function RenderTimeScales(agendaData = state.agenda) {
    if (checkTimeScaleDone()){
        return;
    }

    const container = document.getElementById("root-time-scales");
    container.innerHTML = `
        <h3>Time Scales</h3>
        <div id="time-scale-list-container">
            <div class="time-scale" style="text-align: center; cursor: pointer;" onclick="addTimeScale()">+ New Time Scale</div>
            ${state.timeScales.map((scale)=>{
                const streakCount = getTimeScaleStreak(scale.id);
                const streakClass = streakCount > 0 ? "active" : "inactive";

                return `
                    <div class="time-scale">
                        <div class="time-scale-header" style="display: flex; align-items: center; gap: 8px;">
                            <h3 style="margin: 0;">${scale.name}</h3>
                            
                            <div class="streak-badge ${streakClass}" style="margin-right: auto; transform: scale(0.75); transform-origin: left center;">
                                <svg class="flame-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 24C17.5228 24 22 19.5228 22 14C22 8 15 2 13 0C13 0 13.5 3 12 5C10.5 7 2 9 2 15C2 19.9706 6.47715 24 12 24Z"/>
                                </svg>
                                <span class="streak-number">${streakCount}</span>
                            </div>
                            
                            <div onclick="editTimeScale('${scale.id}')" class="edit-icon" style="cursor: pointer;">⚙</div>
                        </div>
                        <div>Duration: ${scale.duration} day${scale.duration !== 1 ? "s" : ""}</div>
                        <div>
                            ${
                                scale.duration != 1 ? `<div>Start: ${new Date(scale.start).toLocaleDateString('en-GB')}</div>
                                    <div>End: ${new Date(new Date(scale.start).getTime() + (scale.duration-1) * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}</div>`
                                    : `<div>Date: ${new Date(scale.start).toLocaleDateString('en-GB')}</div>`
                            }
                            
                        </div>
                        <div class="time-scale-progress-section">
                            <div class="time-scale-progress-block">
                                <div class="time-scale-progress-meta">
                                    <span>Tasks</span>
                                    <span></span>
                                    <span></span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-bar-fill" style="width: 0%;"></div>
                                </div>
                            </div>
                            <div class="time-scale-progress-block">
                                <div class="time-scale-progress-meta">
                                    <span>Free time used</span>
                                    <span></span>
                                    <span></span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-bar-fill" style="width: 0%;"></div>
                                </div>
                            </div>
                            <div class="time-scale-progress-block">
                                <div class="time-scale-progress-meta">
                                    <span>Time</span>
                                    <span></span>
                                    <span></span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-bar-fill" style="width: 0%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `
            }).join("")}
        </div>
    `
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            UpdateTimeScalesRender(agendaData);
        });
    });
}

let hasRungToday = false;

function getWorkableTimeBetween(startMs, endMs) {
    if (endMs <= startMs) return 0;
    const rawTimeMs = endMs - startMs;
    const slotDurationMs = 15 * 60 * 1000;
    let busyTimeMs = 0;

    state.agenda.forEach(block => {
        if (block.busy && block.iso) {
            const blockStartMs = new Date(block.iso).getTime();
            if (blockStartMs >= startMs && blockStartMs < endMs) {
                busyTimeMs += slotDurationMs;
            }
        }
    });

    return Math.max(0, rawTimeMs - busyTimeMs);
}

function getRequiredWorkByDeadlineMs(targetEndMs) {
    let totalRequiredMs = 0;

    state.tasks.forEach(task => {
        let maxTaskRequiredForDeadlineMs = 0;

        state.timeScales.forEach(scale => {
            const scaleEndMs = new Date(scale.start).getTime() + (scale.duration * 24 * 60 * 60 * 1000);
            const goal = Number(task.times[scale.id]?.goal) || 0;
            const elapsed = Number(task.times[scale.id]?.elapsed) || 0;
            const remainingTaskMs = Math.max(0, (goal - elapsed) * 1000);

            if (remainingTaskMs > 0) {
                let requiredForTaskMs = 0;

                if (scaleEndMs <= targetEndMs) {
                    requiredForTaskMs = remainingTaskMs;
                } else {
                    const futureWorkableMs = getWorkableTimeBetween(targetEndMs, scaleEndMs);
                    requiredForTaskMs = Math.max(0, remainingTaskMs - futureWorkableMs);
                }

                if (requiredForTaskMs > maxTaskRequiredForDeadlineMs) {
                    maxTaskRequiredForDeadlineMs = requiredForTaskMs;
                }
            }
        });

        totalRequiredMs += maxTaskRequiredForDeadlineMs;
    });

    return totalRequiredMs;
}

function UpdateTimeScalesRender(agendaData = state.agenda) {
    checkTimeScaleDone();

    let timeScaleContainers = document.querySelectorAll(".time-scale");

    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

    const requiredWorkTodayMs = getRequiredWorkByDeadlineMs(endOfDay);
    const todayWorkableRemainingMs = getWorkableTimeBetween(now.getTime(), endOfDay);
    const wiggleRoomTodayMs = todayWorkableRemainingMs - requiredWorkTodayMs;

    if (requiredWorkTodayMs > 0) {
        if (wiggleRoomTodayMs >= 0 && wiggleRoomTodayMs <= 5 * 60 * 1000) {
            if (!hasRungToday) {
                ring();

                document.getElementById("modal-title").innerText = "Time Alert";
                document.getElementById("modal-body").innerHTML = `
                    <p>Time to start working on your tasks!</p>
                    <p>You have less than 5 minutes of wiggle room left today before your goals become unreachable.</p>
                `;

                document.getElementById("btn-submit").innerText = "I'll start working!";
                document.getElementById("btn-submit").onclick = function() {
                    closeModal("modal");
                };

                openModal("modal");
                hasRungToday = true;
            }
        } else if (wiggleRoomTodayMs > 5 * 60 * 1000) {
            hasRungToday = false;
        }
    } else {
        hasRungToday = false;
    }

    timeScaleContainers.forEach((timeScaleContainer) => {
        let header = timeScaleContainer.querySelector(".time-scale-header > h3");
        if (!header) return;

        let scale = state.timeScales.find((s) => s.name === header.textContent);
        if (!scale) return;

        const totals = state.tasks.reduce((acc, task) => {
            acc.elapsed += Math.min(Number(task.times[scale.id]?.elapsed) || 0, Number(task.times[scale.id]?.goal) || 0);
            acc.goal += Number(task.times[scale.id]?.goal) || 0;
            return acc;
        }, { elapsed: 0, goal: 0 });

        const taskPercentage = totals.goal > 0
            ? (totals.elapsed / totals.goal) * 100
            : 100;

        const currentTime = Date.now();
        const startTimeMs = new Date(scale.start).getTime() || currentTime;
        const durationDays = Number(scale.duration) || 0;

        const rawTotalTimeMs = durationDays * 24 * 60 * 60 * 1000;
        const slotDurationMs = 15 * 60 * 1000;
        const scaleEndMs = startTimeMs + rawTotalTimeMs;

        let totalExcludedTimeMs = 0;
        let passedExcludedTimeMs = 0;

        agendaData.forEach(block => {
            if (!block.iso || !block.busy) return;

            const blockStartMs = new Date(block.iso).getTime();

            if (blockStartMs >= startTimeMs && blockStartMs < scaleEndMs) {
                totalExcludedTimeMs += slotDurationMs;
                passedExcludedTimeMs += Math.max(0, Math.min(slotDurationMs, currentTime - blockStartMs));
            }
        });

        const totalTimeMs = rawTotalTimeMs - totalExcludedTimeMs;
        const rawTimeUsed = currentTime - startTimeMs;
        const timeUsed = rawTimeUsed - passedExcludedTimeMs;

        const workableRemainingMs = getWorkableTimeBetween(currentTime, scaleEndMs);

        const totalTaskRequiredForDeadlineMs = getRequiredWorkByDeadlineMs(scaleEndMs);

        const currentFreeTimeMs = workableRemainingMs - totalTaskRequiredForDeadlineMs;

        const initialFreeTimeMs = Math.max(0, totalTimeMs - totalTaskRequiredForDeadlineMs);

        const freeTimeUsedMs = Math.max(
            0,
            initialFreeTimeMs - Math.max(0, currentFreeTimeMs)
        );

        const freeTimeUsedPercentage = initialFreeTimeMs > 0
            ? Math.min(100, Math.max(0, (freeTimeUsedMs / initialFreeTimeMs) * 100))
            : (freeTimeUsedMs > 0 ? 100 : 0);

        const timePercentage = (totalTimeMs > 0 && !isNaN(timeUsed))
            ? Math.min(100, Math.max(0, (timeUsed / totalTimeMs) * 100))
            : 0;

        let blocks = timeScaleContainer.querySelectorAll(".time-scale-progress-block");

        blocks.forEach((block) => {
            let meta_info = block.querySelector(".time-scale-progress-meta");
            let progressBarFill = block.querySelector(".progress-bar-fill");
            let label = meta_info.children[0].textContent.trim();

            switch (label) {
                case "Tasks":
                    meta_info.children[1].textContent = `${taskPercentage.toFixed(1)}%`;
                    meta_info.children[2].textContent =
                        `${new Date(totals.elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(totals.goal * 1000).toISOString().substring(11, 19)} (${new Date(Math.max(0, totals.goal - totals.elapsed) * 1000).toISOString().substring(11, 19)} left)`;
                    progressBarFill.style.width = `${Math.min(100, taskPercentage)}%`;
                    break;

                case "Free time used":
                    meta_info.children[1].textContent = `${freeTimeUsedPercentage.toFixed(1)}%`;

                    const wiggleRoomStr = currentFreeTimeMs < 0
                        ? `-${formatDuration(Math.abs(currentFreeTimeMs))}`
                        : formatDuration(currentFreeTimeMs);

                    meta_info.children[2].textContent =
                        `${formatDuration(freeTimeUsedMs)} / ${formatDuration(initialFreeTimeMs)} (${wiggleRoomStr} left)`;

                    progressBarFill.style.width = `${Math.min(100, freeTimeUsedPercentage)}%`;

                    if (currentFreeTimeMs < 0) {
                        progressBarFill.style.backgroundColor = "darkred";
                    } else {
                        progressBarFill.style.backgroundColor = "";
                    }
                    break;

                case "Time":
                    meta_info.children[1].textContent = `${timePercentage.toFixed(1)}%`;
                    meta_info.children[2].textContent =
                        `${formatDuration(timeUsed)} / ${formatDuration(totalTimeMs)} (${formatDuration(Math.max(0, totalTimeMs - timeUsed))} left)`;
                    progressBarFill.style.width = `${Math.min(100, timePercentage)}%`;
                    break;
            }
        });
    });
}

let timeScalesRenderInterval = setInterval(()=>{
    UpdateTimeScalesRender()
}, 1000);

function resetTimes(){
    let dateTemp = new Date();
    dateTemp.setHours(0, 0, 0, 0);
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
    RenderAgenda()
}

const getCellBgStyles = (busy, totalSecondsWorked, isToday) => {
        const hasWork = totalSecondsWorked > 0;
        const percent = hasWork ? Math.min(1, totalSecondsWorked / 900) : 0;
        const greenColor = `rgba(76, 255, 80, ${(percent * 0.8) + 0.2})`;
        let styles = {};

        if (busy && hasWork) {
            styles = { background: `linear-gradient(135deg, lightcoral 30%, ${greenColor} 70%)`, backgroundColor: '' };
        } else if (busy) {
            styles = { background: '', backgroundColor: 'lightcoral' };
        } else if (hasWork) {
            styles = { background: '', backgroundColor: greenColor };
        } else {
            styles = { background: '', backgroundColor: 'transparent' };
        }
        
        if (isToday) {
            styles.borderLeft = '4px solid lightcoral';
            styles.borderRight = '4px solid lightcoral';
        }

        return styles;
    };

function RenderAgenda() { 
    const container = document.getElementById("root-agenda");
    
    const earliestStart = state.timeScales.reduce((min, scale) => {
        const scaleStart = new Date(scale.start).getTime();
        return scaleStart < min ? scaleStart : min;
    }, Infinity);

    const baseDate = new Date(earliestStart);
    baseDate.setHours(0, 0, 0, 0);
    
    const todayStr = new Date().toDateString();
    
    const getTimestamp = (dayOffset, timeOffset) => {
        return baseDate.getTime() + (dayOffset * 24 * 60 * 60 * 1000) + (timeOffset * 15 * 60 * 1000);
    };

    container.innerHTML = `
        <h3>Agenda</h3>
        <table id="agenda-table" style="user-select: none;">
            ${(() => {
                const longestScaleLengthDays = state.timeScales.reduce((max, scale) => Math.max(max, scale.duration), 0);
                let html_output = '';
                const headerCells = ['<th class="agenda-top-left-empty"></th>'];

                for (let j = 0; j < longestScaleLengthDays; j++) {
                    const currentDate = new Date(baseDate.getTime() + j * 24 * 60 * 60 * 1000);
                    const dateString = currentDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
                    headerCells.push(`<th class="agenda-date-header">${dateString}</th>`);
                }
                html_output += `<tr>${headerCells.join("")}</tr>`;

                for (let i = 0; i < 24 * 4; i++) {
                    const isFullHour = i % 4 === 0;
                    const timeLabel = new Date(0, 0, 0, Math.floor(i / 4), (i % 4) * 15)
                        .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

                    const labelContent = isFullHour ? timeLabel : "";
                    const rowCells = [`<td class="agenda-time-label ${isFullHour ? "agenda-time-label-full-hour" : ""}">${labelContent}</td>`];

                    for (let j = 0; j < longestScaleLengthDays; j++) {
                        const timestamp = getTimestamp(j, i);
                        const isoString = new Date(timestamp).toISOString();
                        const isToday = new Date(timestamp).toDateString() === todayStr;
                        
                        const agendaItem = state.agenda.find(item => item.iso === isoString);
                        let totalSecondsWorked = 0;
                        let busy = false;
                        
                        if (agendaItem) {
                            busy = agendaItem.busy;
                            if (agendaItem.tasksWorked) {
                                totalSecondsWorked = Object.values(agendaItem.tasksWorked).reduce((sum, val) => sum + val, 0);
                            }
                        }
                        
                        
                        const bg = getCellBgStyles(busy, totalSecondsWorked, isToday);
                        
                        let inlineStyleStr = bg.background ? `background: ${bg.background};` : `background-color: ${bg.backgroundColor};`;
                        if (bg.borderLeft) {
                            inlineStyleStr += ` border-left: ${bg.borderLeft}; border-right: ${bg.borderRight};`;
                        }
                        
                        rowCells.push(`<td class="agenda-cell" data-day="${j}" data-time="${i}" data-iso="${isoString}" style="border-top: ${isFullHour ? "3" : "1"}px solid black; ${inlineStyleStr}"></td>`);
                    }
                    html_output += `<tr>${rowCells.join("")}</tr>`;
                }
                return html_output;
            })()}
        </table>
    `;

    buildAgendaSelector()
}

const getDataFromCell = (cell) => {
        const day = parseInt(cell.dataset.day, 10);
        const time = parseInt(cell.dataset.time, 10);
        const iso = cell.dataset.iso;
        const existingSlot = state.agenda.find((slot) => slot.iso === iso);
        const busy = existingSlot ? existingSlot.busy : false;

        return { day, time, iso, busy };
    }

    const isinBox = (target, side1, side2) => {
        return (target.day >= Math.min(side1.day, side2.day) && target.day <= Math.max(side1.day, side2.day) && target.time >= Math.min(side1.time, side2.time) && target.time <= Math.max(side1.time, side2.time))
    }

const updatePreview = (startCellData, currentHoverData) => {
        document.querySelectorAll('.agenda-cell').forEach(cell => {
            const cellData = getDataFromCell(cell);
            
            const existingSlot = state.agenda.find(item => item.iso === cellData.iso);
            const totalSecondsWorked = (existingSlot && existingSlot.tasksWorked) 
                ? Object.values(existingSlot.tasksWorked).reduce((sum, val) => sum + val, 0) 
                : 0;
            const isToday = new Date(cellData.iso).toDateString() === new Date().toDateString();
            let bg;
            if (startCellData && currentHoverData)  bg = getCellBgStyles(isinBox(cellData, startCellData, currentHoverData) ? !startCellData.busy : cellData.busy , totalSecondsWorked, isToday);
            else bg = getCellBgStyles(cellData.busy, totalSecondsWorked, isToday)
            cell.style.background = bg.background;
            cell.style.backgroundColor = bg.backgroundColor;
        });
    };

function buildAgendaSelector() {
    const table = document.getElementById("agenda-table");
    let startCellData = null;
    let currentHoverData = null;

    const getPreviewAgenda = (start, current) => {
        let previewAgenda = JSON.parse(JSON.stringify(state.agenda));
        document.querySelectorAll('.agenda-cell').forEach(cell => {
            const cellData = getDataFromCell(cell);
            if (isinBox(cellData, start, current)) {
                let existingItem = previewAgenda.find(item => item.iso === cellData.iso);
                if (!start.busy) {

                    if (existingItem) existingItem.busy = true;
                    else previewAgenda.push({ iso: cellData.iso, busy: true, tasksWorked: {} });
                } else {
                    if (existingItem) existingItem.busy = false;
                }
            }
        });
        return previewAgenda;
    };

    table.addEventListener("mousedown", (event) => {
        if (event.target.tagName === "TD" && event.target.classList.contains("agenda-cell")) {
            startCellData = getDataFromCell(event.target);
            currentHoverData = startCellData;
            
            updatePreview(startCellData, currentHoverData);
            UpdateTimeScalesRender(getPreviewAgenda(startCellData, currentHoverData));
            isEditingAgenda = true;
        }
    });

    table.addEventListener("mouseover", (event) => {
        if (startCellData && event.target.tagName === "TD" && event.target.classList.contains("agenda-cell")) {
            currentHoverData = getDataFromCell(event.target);
            
            updatePreview(startCellData, currentHoverData);
            UpdateTimeScalesRender(getPreviewAgenda(startCellData, currentHoverData));
        }
    });

    if (window.agendaMouseUpHandler) {
        document.removeEventListener("mouseup", window.agendaMouseUpHandler);
    }

    window.agendaMouseUpHandler = () => {
        if (startCellData && currentHoverData) {

            document.querySelectorAll('.agenda-cell').forEach(cell => {
                const cellData = getDataFromCell(cell);
                
                if (isinBox(cellData, startCellData, currentHoverData)) {
                    let existingItem = state.agenda.find(item => item.iso === cellData.iso);
                    
                    if (!startCellData.busy) {
                        if (existingItem) {
                            existingItem.busy = true;
                        } else {
                            state.agenda.push({ iso: cellData.iso, busy: true, tasksWorked: {} });
                        }
                    } else {
                        if (existingItem) {
                            existingItem.busy = false;
                        }
                    }
                }
            });

            startCellData = null;
            currentHoverData = null;
            isEditingAgenda = false;
            
            Save();
            UpdateTimeScalesRender();
            updatePreview();
        }
    };

    document.addEventListener("mouseup", window.agendaMouseUpHandler);
}

function checkTimeScaleDone() {
    let SomethingChanged = false;

    state.timeScales.forEach((scale) => {
        const scaleDurationMs = scale.duration * 24 * 60 * 60 * 1000;
        
        if (new Date(scale.start).getTime() + scaleDurationMs < new Date().getTime()) {
            console.log(`Time scale reset for "${scale.name}".`);

            const totals = state.tasks.reduce((acc, task) => {
                acc.elapsed += Number(task.times[scale.id]?.elapsed) || 0; 
                acc.goal += Number(task.times[scale.id]?.goal) || 0;
                return acc;
            }, { elapsed: 0, goal: 0 });

            state.statistics.push({
                scaleId: scale.id,
                name: scale.name,
                timeWorked: totals.elapsed,
                goal: totals.goal,
                duration: scale.duration,
                start: scale.start,
                tasks: state.tasks.map((task)=>{
                    return {
                        id: task.id,
                        name: task.name,
                        elapsed: task.times[scale.id].elapsed,
                        goal: task.times[scale.id].goal,
                    }
                })
            });

            
            let newDate = new Date()
            newDate.setHours(0,0,0,0)
            scale.start = newDate.toISOString();
            SomethingChanged = true;
            
            let runningTask = null;

            state.tasks.forEach((task) => {
                if (task.times && task.times[scale.id]) {
                    task.times[scale.id].elapsed = 0;
                }
                
                if (task.running) {
                    runningTask = task;
                }
            });

            if (runningTask) {
                startTime = new Date().getTime();
                startCounters = JSON.parse(JSON.stringify(runningTask.times));
            }
        }
    });

    if (SomethingChanged) {
        Save();
        RenderTasks();
        RenderTimeScales()
        RenderAgenda()
        RenderStatistics();
    }

    return SomethingChanged;
}

function RenderStatistics() {
    const container = document.getElementById("root-statistics");
    if (!container) return;

   
    if (!state.statistics || state.statistics.length === 0) {
        container.innerHTML = `
            <h3>Statistics</h3>
            <div style="text-align: center; color: #666; margin-top: 20px; padding: 20px; border: 1px dashed #ccc; border-radius: 8px;">
                No statistics available yet. Complete a time scale to see your history.
            </div>
        `;
        return;
    }

    
    const sortedStats = [...state.statistics].reverse();

    container.innerHTML = `
        <h3>Statistics</h3>
        <div id="statistics-list-container">
            ${sortedStats.map((stat) => {
                const start = new Date(stat.start);
                let end = new Date(start.getTime() + (stat.duration-1) * 24 * 60 * 60 * 1000);
                const dateRange = `${start.toLocaleDateString('en-GB')}${stat.duration == 1 ? "" : `- ${end.toLocaleDateString('en-GB')}`}`;
            
                const cappedTotalWorked = stat.tasks.reduce((sum, task) => {
                    return sum + Math.min(Number(task.elapsed) || 0, Number(task.goal) || 0);
                }, 0);

                const totalProgress = stat.goal > 0 ? (cappedTotalWorked / stat.goal) * 100 : 100;

                return `
                    <div class="time-scale" style="margin-bottom: 20px; opacity: 0.9;">
                        <div class="time-scale-header">
                            <h3>${stat.name} [${dateRange}]</h3>
                            <div style="font-size: 0.85em; color: #666; text-align: right;">
                                (${stat.duration} day${stat.duration > 1 ? 's' : ''})
                            </div>
                        </div>
                        
                        <div class="time-scale-progress-section" style="margin-top: 10px;">
                            <div class="time-scale-progress-block">
                                <div class="time-scale-progress-meta">
                                    <span>Total Completion</span>
                                    <span>${totalProgress.toFixed(1)}%</span>
                                    <span>${formatDuration(cappedTotalWorked * 1000)} / ${formatDuration(stat.goal * 1000)}</span>
                                </div>
                                <div class="progress-bar" style="background-color: red">
                                    <div class="progress-bar-fill" style="width: ${Math.min(100, totalProgress)}%;"></div>
                                </div>
                            </div>
                        </div>

                        <div style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
                            <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: #555;">Task Breakdown</h4>
                            
                            <div class="task-progress-list" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
                                ${stat.tasks.map(task => {
                                    if (task.goal <= 0) return "";
                                    const taskProgress = task.goal > 0 ? (task.elapsed / task.goal) * 100 : 0;
                                    return `
                                        <div class="task-progress-row">
                                            <div class="task-progress-meta">
                                                <span>${task.name}</span>
                                                <span>${taskProgress.toFixed(1)}%</span>
                                                <span>${formatDuration(task.elapsed * 1000)} / ${formatDuration(task.goal * 1000)}</span>
                                            </div>
                                            <div class="progress-bar task-progress-bar" style="background-color: red">
                                                <div class="progress-bar-fill" style="width: ${Math.min(100, taskProgress)}%;"></div>
                                            </div>
                                        </div>
                                    `;
                                }).join("")}
                            </div>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}
function openHelp(){
    document.getElementById("modal-title").innerText = "How to use the tracker";
    document.getElementById("modal-body").innerHTML = `
        <div style="line-height: 1.6; max-height: 60vh; overflow-y: auto; padding-right: 10px;">
            <p>This app is designed to help you balance your goals by tracking your tasks against the actual time you have available.</p>
            
            <hr style="margin: 15px 0; border: 0; border-top: 1px solid #ccc;" />

            <h4 style="margin-bottom: 5px;">Setting Your Timeframes</h4>
            <p style="margin-top: 0; font-size: 0.95em;">
                Start by setting up throught which time frames (daily, weekly, etc.) you want to set goals for. You can always tweak the duration and start date later by clicking the gear icon. As you work, the app will automatically measure your progress against these broader periods.
            </p>

            <h4 style="margin-bottom: 5px;">Working on Tasks</h4>
            <p style="margin-top: 0; font-size: 0.95em;">
                Once your scales are set, create some tasks. Clicking the gear icon on any task lets you assign specific time goals for it across each of your active time scales.<br>When you're ready to focus, simply click a task to start its timer. To pause it, just click it again or select a different task to switch what you are working on.
            </p>

            <h4 style="margin-bottom: 5px;">Managing Your Schedule</h4>
            <p style="margin-top: 0; font-size: 0.95em;">
                The Agenda is your daily schedule broken into 15-minute chunks. By clicking and dragging across the grid, you can block out times when you are asleep or busy. The app subtracts these red blocks from your active Time Scales, giving you a better picture of your actual workable hours.
            </p>

            <h4 style="margin-bottom: 5px;">Audio information</h4>
            <p style="margin-top: 0; font-size: 0.95em;">
                Make sure your volume is up so the app can guide you. You'll hear a single chime when you cross a specific time goal, a double chime when an entire task is completely finished, and three chimes when a full Time Scale wraps up.<br>If your schedule gets tight and you need to start working within the next 5 minutes to meet your goals, a ringing alarm will inform you.
            </p>

            <h4 style="margin-bottom: 5px;">Resetting</h4>
            <p style="margin-top: 0; font-size: 0.95em;">
                You can reset all timers and start all timescales over again by clicking the "Reset" button on the top right.
            </p>
        </div>
    `;

    document.getElementById("btn-submit").innerText = "Let's go!";
    document.getElementById("btn-submit").onclick = function() {
        closeModal("modal");
    }
    openModal("modal");
}

openModal = (id) => document.getElementById(id).classList.add('active');
closeModal = (id) => {
    document.getElementById("delete-button")?.remove();
    document.getElementById("move-up-button")?.remove();
    document.getElementById(id).classList.remove('active');
};

Load()
RenderTasks()
RenderTimeScales()
RenderAgenda()
RenderStatistics()