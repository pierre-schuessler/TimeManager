let state = {
    tasks: [],
    timeScales: []
}

function Load() {
    let savedTimeScales = localStorage.getItem("timeScales")
    
    // Create a date object strictly set to today's local midnight
    let todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    state.timeScales = savedTimeScales ? JSON.parse(savedTimeScales) : [
        {
            id: "daily",
            name: "Daily",
            duration: 1,
            start: todayMidnight.toISOString() // Now correctly saves exactly 00:00:00
        },
    ]

    let savedTasks = localStorage.getItem("tasks")
    state.tasks = savedTasks ? JSON.parse(savedTasks) : []
}

function Save() {
    localStorage.setItem("timeScales", JSON.stringify(state.timeScales))

    // save with all tasks being not running without affecting the state
    let tasksToSave = state.tasks.map((task)=>{
        return {
            ...task,
            running: false
        }
    })
    localStorage.setItem("tasks", JSON.stringify(tasksToSave))
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
    RenderGraphics()
}

let interval;
let startTime;
let startCounters;

function toggleTask(id, UITarget){
    let task = state.tasks.find((task)=>task.id === id)
    // check if running
    clearInterval(interval);
    if (task.running) {
        task.running = false
        RenderTasks()
    } else {
        // stop all other tasks
        state.tasks.forEach((task)=>{
            task.running = false
        })
        task.running = true
        startTime = new Date().getTime()
        // copy the current elapsed times to startCounters by value, not by reference
        startCounters = JSON.parse(JSON.stringify(task.times))

        RenderTasks()
        RenderGraphics()
        interval = setInterval(()=>{
            // Calculate elapsed time once per tick
            let elapsedTime = (new Date().getTime() - startTime) / 1000
            
            state.timeScales.forEach((scale)=>{
                // Safe to use startCounters here now, as it's always in sync
                task.times[scale.id].elapsed = Math.round(startCounters[scale.id].elapsed + elapsedTime)
                task.times[scale.id].elapsed = Math.min(task.times[scale.id].elapsed, task.times[scale.id].goal) // cap at goal
            });
            
            let allCompleted = state.timeScales.every((scale)=>{
                return task.times[scale.id].elapsed >= task.times[scale.id].goal
            })
            if (allCompleted) {
                task.running = false
                clearInterval(interval);
            }

            // check if any time scale is completed (start + amount of days)
            state.timeScales.forEach((scale)=>{
                if (new Date(scale.start).getTime() + scale.duration * 24 * 60 * 60 * 1000 < new Date().getTime()) {
                    scale.start = new Date().toISOString()
                    // reset all of the elapsed times for this scale
                    state.tasks.forEach((task)=>{
                        task.times[scale.id].elapsed = 0
                    })
                    
                    // If we reset a scale while running, we must also update the snapshot!
                    if (task.running) {
                        startTime = new Date().getTime();
                        startCounters = JSON.parse(JSON.stringify(task.times));
                    }
                }
            })

            // update the UI
            RenderTasks()
            RenderGraphics()
            Save()
        }, 1000)
    }
}

function editTask(id) {
    let task = state.tasks.find((task)=>task.id === id)
    document.getElementById("modal-title").innerText = "Edit Task";
    document.getElementById("modal-body").innerHTML = `
        <div class="form-group ">
            <label>Name <span style="color:red">*</span></label>
            <input type="text" id="modal-taskName" value="${task.name}">
        </div>

        ${
            state.timeScales.map((scale)=>{
                return `
                    <div class="form-group">
                        <label>${scale.name} goal (in seconds) <span style="color:red">*</span></label>
                        <input type="number" id="modal-task-${scale.id}-goal" value="${task.times[scale.id].goal}">
                    </div>
                `
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
        task.times = state.timeScales.reduce((acc, scale) => {
            const newGoal = parseInt(document.getElementById(`modal-task-${scale.id}-goal`).value);
            if (isNaN(newGoal)) {
                alert("Invalid input. Please try again.");
                throw new Error("Invalid input");
            }
            acc[scale.id] = {
                ...task.times[scale.id],
                goal: newGoal
            };
            return acc;
        }, {});
        Save();
        RenderTasks();
        RenderGraphics();
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
                    // Check the state to determine the color
                    const backgroundColor = task.running ? 'lightgreen' : ''; 
                    
                    return `
                        <div class="task" style="background-color: ${backgroundColor}; cursor: pointer;" onclick="if (event.target.classList.contains('edit-icon')) { return; } toggleTask('${task.id}', this)">
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
                                                    <span>${task.times[scale.id].elapsed} / ${task.times[scale.id].goal}</span>
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

        // Update existing tasks with the new time scale
        state.tasks.forEach((task) => {
            task.times[newScale.id] = {
                elapsed: 0,
                goal: 3600 // Default goal for new time scales
            };
            
            // Keep track if this task is currently the running one
            if (task.running) {
                runningTask = task;
            }
        });

        // Recreate the snapshot and reset the timer if a task is actively running
        if (runningTask) {
            startTime = new Date().getTime();
            startCounters = JSON.parse(JSON.stringify(runningTask.times));
        }

        Save();
        RenderTimeScales();
        RenderTasks();
        RenderGraphics();
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
            RenderGraphics();
            closeModal("modal");
        } else {
            alert("Invalid input. Please try again.");
        }
    }
    openModal("modal");
}

function RenderTimeScales() {
    const container = document.getElementById("root-time-scales");
    container.innerHTML = `
        <h3>Time Scales</h3>
        <div id="time-scale-list-container">
            <div class="time-scale" style="text-align: center; cursor: pointer;" onclick="addTimeScale()">+ New Time Scale</div>
            ${state.timeScales.map((scale)=>{
                return `
                    <div class="time-scale">
                        <h3>${scale.name}</h3>
                        <div>Duration: ${scale.duration} day${scale.duration !== 1 ? "s" : ""}</div>
                        <div>
                            <div>Start: ${new Date(scale.start).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</div>
                            <div>End: ${new Date(new Date(scale.start).getTime() + scale.duration * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</div>
                        </div>
                        <div onclick="editTimeScale('${scale.id}')" class="edit-icon">⚙</div>
                    </div>
                    
                `
            }).join("")}
            
        </div>
    `
}

function RenderGraphics() {
    const container = document.getElementById("root-graphics");
    
    container.innerHTML = `
        <h3>Graphics</h3>
        <div id="graphics-container">
            ${state.timeScales.map((scale) => {
                
                // 1. Calculate Task Progress
                const totals = state.tasks.reduce((acc, task) => {
                    acc.elapsed += Number(task.times[scale.id]?.elapsed) || 0;
                    acc.goal += Number(task.times[scale.id]?.goal) || 0;
                    return acc;
                }, { elapsed: 0, goal: 0 });

                const percentage = totals.goal > 0 
                    ? Math.min(100, (totals.elapsed / totals.goal) * 100) 
                    : 0;

                // 2. Calculate Time Progress
                const current_time = Date.now();
                
                // NEW: Safely parse the ISO Date string into milliseconds
                // If it fails for any reason, default to current time
                const startTimeMs = new Date(scale.start).getTime() || current_time;
                const durationDays = Number(scale.duration) || 0;

                // Calculate time used directly in milliseconds
                const time_used = current_time - startTimeMs; 
                const total_time_ms = durationDays * 24 * 60 * 60 * 1000; 
                
                const percentage_time = (total_time_ms > 0 && !isNaN(time_used))
                    ? Math.max(0, Math.min(100, (time_used / total_time_ms) * 100)) 
                    : 0;

                // 3. Render Output
                return `
                    <div class="graphic" style="margin-bottom: 24px;">
                        <h4>${scale.name || "Unknown Scale"}</h4>
                        
                        <div class="progress-bar">
                            <div class="progress-bar-fill" style="width: ${percentage}%;"></div>
                        </div>
                        <div>Tasks: ${totals.elapsed} / ${totals.goal} seconds</div>
                        
                        <div class="progress-bar" style="margin-top: 8px;">
                            <div class="progress-bar-fill" style="width: ${percentage_time}%;"></div>
                        </div>
                        <div>Time Elapsed: ${percentage_time.toFixed(2)}%</div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

openModal = (id) => document.getElementById(id).classList.add('active');
closeModal = (id) => document.getElementById(id).classList.remove('active');

Load()
RenderTasks()
RenderTimeScales()
RenderGraphics()