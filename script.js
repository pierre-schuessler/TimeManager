import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js"; 
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getDatabase, ref, set, get, child, onValue, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJNvK9FJ06goVNdwXkzFViiqSdoeQSZ3Y",
  authDomain: "task-timer-5707f.firebaseapp.com",
  databaseURL: "https://task-timer-5707f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "task-timer-5707f",
  storageBucket: "task-timer-5707f.firebasestorage.app",
  messagingSenderId: "92789344543",
  appId: "1:92789344543:web:708c7e15e3353e8f7a882a",
  measurementId: "G-0Z2XZ4R834"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getDatabase(app);

let hasSyncedWithFirebase = false;

let state = {
  tasks: {},
  timeScales: {},
  agenda: {},
  statistics: {}
}

function getSafeIsoString(date) {
  return date.toISOString().split('.')[0] + 'Z';
}

onAuthStateChanged(auth, async (user) => {
  let openLoginButton = document.getElementById("btn-open-login")
  let migrateButton = document.getElementById("btn-migrate")
  document.getElementById("btn-help").classList.remove("btn-primary");
  
  if (user) {
    openLoginButton.textContent = "Log out"
    openLoginButton.setAttribute('onclick','Logout()')
    migrateButton.style.display = "";
    setupFirebaseListener()
  } else {
    openLoginButton.textContent = "Log in"
    openLoginButton.setAttribute('onclick','openLogin()')
    migrateButton.style.display = "none";
  }
  
  await Load();

  let runningTask = Object.values(state.tasks).find(t => t.running);
  if (runningTask) {
    document.body.classList.add("active");
    startTime = runningTask.startedAt || new Date().getTime();
    startCounters = JSON.parse(JSON.stringify(runningTask.times));
    lastTime = new Date().getTime();
    catchUpLocalAgenda();
    timerWorker.postMessage('start');
  } else {
    document.body.classList.remove("active");
  }

  RenderTasks();
  RenderTimeScales();
  RenderAgenda();
  
  openLoginButton.style.display = "";
  hideLoading();
});

function Logout(){ signOut(auth); }

function openLogin(){
  document.getElementById("modal-title").innerText = "Log in or register";
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group">
      <label>Email<span style="color:red">*</span></label>
      <input type="email" id="email-input" value="">
    </div>
    <div class="form-group">
      <label>Password<span style="color:red">*</span></label>
      <input type="password" id="password-input" value="">
    </div>
    <p>Please note that you should never try to modify any of your data on two devices at once. This includes starting to work on tasks, editing the calendar, editing or creating tasks.</p>
  `;

  document.getElementById("btn-submit").innerText = "Log in";
  document.getElementById("btn-submit").onclick = async function() {
    const email = document.getElementById("email-input").value;
    const password = document.getElementById("password-input").value;
    
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      closeModal("modal");
      return userCredential.user;
    } catch (error) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        const newUserCredential = await createUserWithEmailAndPassword(auth, email, password);
        closeModal("modal");
        return newUserCredential.user;
      } catch (creationError) {
        console.error("Error creating account:", creationError.message);
      }
      } else {
      console.error("Error during sign in:", error.message);
      }
    }
  }
  openModal("modal");
}

window.Logout = Logout;
window.openLogin = openLogin;

async function migrateToFirebase() {
  const user = auth.currentUser;
  if (!user) {
    console.log("Not connected to Firebase. Migration aborted.");
    return;
  }
  if (!window.confirm("Are you sure you want to migrate your local data to firebase? This will override anything stored on your account.")) return;

  try {
    const localTimeScales = localStorage.getItem("timeScales");
    const localTasks = localStorage.getItem("tasks");
    const localAgenda = localStorage.getItem("agenda");
    const localStatistics = localStorage.getItem("statistics");

    if (!localTimeScales && !localTasks && !localAgenda && !localStatistics) {
      console.log("No local storage data found to migrate.");
      return;
    }

    let loadedScales = localTimeScales ? JSON.parse(localTimeScales) : {};
    let loadedTasks = localTasks ? JSON.parse(localTasks) : {};
    
    Object.values(loadedTasks).forEach(task => {
      if (task.isHabit === undefined) task.isHabit = false;
      if (task.sessionDuration === undefined) task.sessionDuration = 1800;
      if (!task.times) task.times = {};
      Object.keys(loadedScales).forEach(scaleId => {
        if (!task.times[scaleId]) task.times[scaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 };
        if (task.times[scaleId].sessions === undefined) task.times[scaleId].sessions = 0;
        if (task.times[scaleId].targetSessions === undefined) task.times[scaleId].targetSessions = 1;
      });
      if (!task.subtasks) task.subtasks = {};
    });

    let loadedAgenda = localAgenda ? JSON.parse(localAgenda) : {};
    let loadedStatistics = localStatistics ? JSON.parse(localStatistics) : {};

    await set(ref(db, `users/${user.uid}`), {
      timeScales: loadedScales,
      tasks: loadedTasks,
      agenda: loadedAgenda,
      statistics: loadedStatistics
    });

    console.log("Successfully migrated local data to Firebase!");
    
    await Load()
    RenderTasks();
    RenderTimeScales();
    RenderAgenda();

  } catch (error) {
    console.error("Error migrating data to Firebase:", error);
  }
}

window.migrateToFirebase = migrateToFirebase;

let isSavingLocally = false;

function setupFirebaseListener() {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = ref(db, `users/${user.uid}`);
  
  onValue(userRef, (snapshot) => {
    
    if (isSavingLocally) {
      isSavingLocally = false; 
      return; 
    }
    
    if (snapshot.exists()) {
      const fbData = snapshot.val();
      let wasRunning = Object.values(state.tasks).find(t => t.running);
      
      let needsTasksRender = true;
      let needsAgendaRender = true;
      
      const incomingTimeScales = fbData.timeScales || {};
      let needsTimeScalesRender = JSON.stringify(state.timeScales) !== JSON.stringify(incomingTimeScales);
      state.timeScales = incomingTimeScales;

      let incomingTasks = fbData.tasks || {};
      Object.values(incomingTasks).forEach(task => {
        if (task.isHabit === undefined) task.isHabit = false;
        if (task.sessionDuration === undefined) task.sessionDuration = 1800;
        if (!task.times) task.times = {};
        Object.keys(state.timeScales).forEach(scaleId => {
          if (!task.times[scaleId]) task.times[scaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 };
          if (task.times[scaleId].sessions === undefined) task.times[scaleId].sessions = 0;
          if (task.times[scaleId].targetSessions === undefined) task.times[scaleId].targetSessions = 1;
        });
        if (!task.subtasks) task.subtasks = {};
      });
      state.tasks = incomingTasks;
      
      state.agenda = fbData.agenda || {};
      state.statistics = fbData.statistics || {};

      let isRunningNow = Object.values(state.tasks).find(t => t.running);

      if (isRunningNow && (!wasRunning || wasRunning.id !== isRunningNow.id)) {
        document.body.classList.add("active");
        startTime = isRunningNow.startedAt || new Date().getTime();
        startCounters = JSON.parse(JSON.stringify(isRunningNow.times));
        lastTime = new Date().getTime();
        catchUpLocalAgenda();
        timerWorker.postMessage('start');
      } else if (!isRunningNow && wasRunning) {
        document.body.classList.remove("active");
        timerWorker.postMessage('stop');
      }

      if (needsTasksRender) RenderTasks();
      if (needsTimeScalesRender) RenderTimeScales();
      if (needsAgendaRender) RenderAgenda();
    }
    hasSyncedWithFirebase = true;
  }, (error) => {
    console.error(error);
  });
}

async function Load() {
  const user = auth.currentUser;
  let rawData = {};

  if (user) {
    try {
      const dbRef = ref(db);
      const snapshot = await get(child(dbRef, `users/${user.uid}`));
      if (snapshot.exists()) {
        const fbData = snapshot.val();
        if (fbData.timeScales) rawData.timeScales = JSON.stringify(fbData.timeScales);
        if (fbData.tasks) rawData.tasks = JSON.stringify(fbData.tasks);
        if (fbData.agenda) rawData.agenda = JSON.stringify(fbData.agenda);
        if (fbData.statistics) rawData.statistics = JSON.stringify(fbData.statistics);
      }
    } catch (error) { console.error(error); }
  } else {
    rawData = {
      timeScales: localStorage.getItem("timeScales"),
      tasks: localStorage.getItem("tasks"),
      agenda: localStorage.getItem("agenda"),
      statistics: localStorage.getItem("statistics")
    }
  }

  let todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  state.timeScales = rawData.timeScales ? JSON.parse(rawData.timeScales) : {};
  if (Object.keys(state.timeScales).length === 0) {
    const id = crypto.randomUUID();
    state.timeScales[id] = { id: id, name: "Daily", duration: 1, start: todayMidnight.toISOString() };
  }

  state.tasks = rawData.tasks ? JSON.parse(rawData.tasks) : {};
  Object.values(state.tasks).forEach(task => {
    if (task.isHabit === undefined) task.isHabit = false;
    if (task.sessionDuration === undefined) task.sessionDuration = 1800;
    if (!task.times) task.times = {};
    Object.keys(state.timeScales).forEach(scaleId => {
      if (!task.times[scaleId]) task.times[scaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 };
      if (task.times[scaleId].sessions === undefined) task.times[scaleId].sessions = 0;
      if (task.times[scaleId].targetSessions === undefined) task.times[scaleId].targetSessions = 1;
    });
    if (!task.subtasks) task.subtasks = {};
  });

  let rawAgenda = rawData.agenda ? JSON.parse(rawData.agenda) : {};
  state.agenda = {};
  Object.entries(rawAgenda).forEach(([iso, item]) => {
    let safeIso = iso.includes('.') ? iso.split('.')[0] + 'Z' : iso;
    item.iso = safeIso;
    state.agenda[safeIso] = item;
  });

  state.statistics = rawData.statistics ? JSON.parse(rawData.statistics) : {};
}

async function Save(firebase = false) {
  let cleanTasks = {};
  Object.values(state.tasks).forEach(task => {
    let cleanSubtasks = {};
    Object.values(task.subtasks || {}).forEach(sub => {
      let { deleteTimeout, ...cleanSub } = sub;
      cleanSubtasks[sub.id] = cleanSub;
    });
    cleanTasks[task.id] = { ...task, running: !!task.running, subtasks: cleanSubtasks };
  });

  const earliestStart = Object.values(state.timeScales).reduce((min, scale) => {
    const scaleStart = new Date(scale.start).getTime();
    return scaleStart < min ? scaleStart : min;
  }, Infinity);

  let cleanAgenda = {};
  Object.entries(state.agenda).forEach(([iso, item]) => {
    const itemTime = new Date(iso).getTime();
    const hasData = item.busy || (item.tasksWorked && Object.keys(item.tasksWorked).length > 0);
    const isAfterStart = itemTime >= (earliestStart - 2 * 86400 * 1000);
    if (hasData && isAfterStart) {
      cleanAgenda[iso] = item;
    }
  });
  state.agenda = cleanAgenda;

  const user = auth.currentUser;
  
  if (user && firebase) {
    if (!hasSyncedWithFirebase)
    {
        document.getElementById("modal-title").innerText = "You are out of sync with the database";
        document.getElementById("modal-body").innerHTML = `<p>It seems you have been disconnected from the database for a while. To prevent data loss, you will need to reload the page and try again.</p><p>Please be aware that your last change was not saved.</p>`;
        document.getElementById("btn-submit").innerText = "Reload";
        document.getElementById("modal-cancel").style.display = "none";
        document.querySelector(".close-btn").style.display = "none";
        document.getElementById("btn-submit").onclick = function() { location.reload() };
        openModal("modal");
    };
    isSavingLocally = true; 
    try {
      await set(ref(db, `users/${user.uid}`), {
        timeScales: state.timeScales,
        tasks: cleanTasks,
        agenda: state.agenda,
        statistics: state.statistics
      });
    } catch (error) {
      isSavingLocally = false;
      console.error(error);
    }
  } 
  
  if (!user) {
    localStorage.setItem("timeScales", JSON.stringify(state.timeScales));
    localStorage.setItem("tasks", JSON.stringify(cleanTasks));
    localStorage.setItem("agenda", JSON.stringify(state.agenda));
    localStorage.setItem("statistics", JSON.stringify(state.statistics));
  }
}

let dingQueue = [];
let isDinging = false;
function processDingQueue() {
  if (dingQueue.length === 0) { isDinging = false; return; }
  isDinging = true;
  const n = dingQueue.shift();
  for (let i = 0; i < n; i++) setTimeout(() => { new Audio('ding.mp3').play(); }, i * 300);
  setTimeout(processDingQueue, (n * 300) + 1500);
}
function ding(n){ dingQueue.push(n); if (!isDinging) processDingQueue(); }
function ring(){ new Audio('ring.mp3').play(); }

function createNewTask(){
  let times = {}
  Object.keys(state.timeScales).forEach((scaleId)=>{
    times[scaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 }
  });

  const newId = crypto.randomUUID();
  state.tasks[newId] = {
    id: newId,
    name: "New Task",
    isHabit: false,
    sessionDuration: 1800,
    times: times,
    running: false,
    subtasks: {},
    order: Object.keys(state.tasks).length
  };

  Save(true)
  RenderTasks()
  RenderTimeScales()
}

function catchUpLocalAgenda() {
  let task = Object.values(state.tasks).find(t => t.running);
  if (!task || !startTime) return;

  let now = new Date().getTime();
  let timeRemaining = now - startTime; 
  let timeMarker = now;

  while (timeRemaining > 0) {
    let markerDate = new Date(timeMarker);
    let minutes = Math.floor(markerDate.getMinutes() / 15) * 15;
    let slotStart = new Date(markerDate.getFullYear(), markerDate.getMonth(), markerDate.getDate(), markerDate.getHours(), minutes, 0, 0);
    let slotStartTime = slotStart.getTime();
    
    let timeInThisSlot;
    if (timeMarker === slotStartTime) { timeMarker -= 1; continue; } 
    else { timeInThisSlot = Math.min(timeRemaining, timeMarker - slotStartTime); }
    
    let currentSlotIso = getSafeIsoString(slotStart);
    
    if (!state.agenda[currentSlotIso]) {
      state.agenda[currentSlotIso] = { iso: currentSlotIso, busy: false, tasksWorked: {} };
    }
    if (!state.agenda[currentSlotIso].tasksWorked) {
      state.agenda[currentSlotIso].tasksWorked = {};
    }
    
    let timeInThisSlotSeconds = timeInThisSlot / 1000;
    state.agenda[currentSlotIso].tasksWorked[task.id] = (state.agenda[currentSlotIso].tasksWorked[task.id] || 0) + timeInThisSlotSeconds;

    timeMarker -= timeInThisSlot;
    timeRemaining -= timeInThisSlot;
  }
}

const timerWorker = new window.Worker('timerWorker.js');
let startTime; let startCounters; let lastTime; let deltaTime = 0;

timerWorker.onmessage = function(e) {
  if (e.data === 'tick') {
    let task = Object.values(state.tasks).find((t) => t.running === true);
    if (!task) { timerWorker.postMessage('stop'); return; }

    let now = new Date().getTime();
    let elapsedTime = (now - startTime) / 1000;
    deltaTime = now - lastTime;
    lastTime = now;
    
    let timeRemaining = deltaTime; 
    let timeMarker = now;

    while (timeRemaining > 0) {
      let markerDate = new Date(timeMarker);
      let minutes = Math.floor(markerDate.getMinutes() / 15) * 15;
      let slotStart = new Date(markerDate.getFullYear(), markerDate.getMonth(), markerDate.getDate(), markerDate.getHours(), minutes, 0, 0);
      let slotStartTime = slotStart.getTime();
      
      let timeInThisSlot;
      if (timeMarker === slotStartTime) { timeMarker -= 1; continue; } 
      else { timeInThisSlot = Math.min(timeRemaining, timeMarker - slotStartTime); }
      
      let currentSlotIso = getSafeIsoString(slotStart);
      
      if (!state.agenda[currentSlotIso]) {
        state.agenda[currentSlotIso] = { iso: currentSlotIso, busy: false, tasksWorked: {} };
      }
      if (!state.agenda[currentSlotIso].tasksWorked) {
        state.agenda[currentSlotIso].tasksWorked = {};
      }
      
      let timeInThisSlotSeconds = timeInThisSlot / 1000;
      state.agenda[currentSlotIso].tasksWorked[task.id] = (state.agenda[currentSlotIso].tasksWorked[task.id] || 0) + timeInThisSlotSeconds;

      timeMarker -= timeInThisSlot;
      timeRemaining -= timeInThisSlot;
      updatePreview();
    }

    const wasAllCompleted = Object.values(state.timeScales).every(scale =>
      task.times[scale.id].elapsed >= task.times[scale.id].goal
    );

    const prevScaleCompletion = {};
    Object.values(state.timeScales).forEach(scale => {
      const totals = Object.values(state.tasks).reduce((acc, t) => {
        acc.elapsed += Math.min(Number(t.times[scale.id]?.elapsed) || 0, Number(t.times[scale.id]?.goal) || 0);
        acc.goal += Number(t.times[scale.id]?.goal) || 0;
        return acc;
      }, { elapsed: 0, goal: 0 });
      prevScaleCompletion[scale.id] = totals.goal > 0 && totals.elapsed >= totals.goal;
    });

    let anyCrossed = false;
    Object.values(state.timeScales).forEach(scale => {
      if(!startCounters) startCounters = JSON.parse(JSON.stringify(task.times));
      if(!startCounters[scale.id]) startCounters[scale.id] = {elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1};

      const newElapsed = Math.round(startCounters[scale.id].elapsed + elapsedTime);
      if (task.times[scale.id].elapsed < task.times[scale.id].goal && newElapsed >= task.times[scale.id].goal) {
        anyCrossed = true;
      }
      task.times[scale.id].elapsed = newElapsed;
    });

    const isAllCompleted = Object.values(state.timeScales).every(scale =>
      task.times[scale.id].elapsed >= task.times[scale.id].goal
    );

    let scaleFinished = false;
    Object.values(state.timeScales).forEach(scale => {
      const totals = Object.values(state.tasks).reduce((acc, t) => {
        acc.elapsed += Math.min(Number(t.times[scale.id]?.elapsed) || 0, Number(t.times[scale.id]?.goal) || 0);
        acc.goal += Number(t.times[scale.id]?.goal) || 0;
        return acc;
      }, { elapsed: 0, goal: 0 });

      const isCompleted = totals.goal > 0 && totals.elapsed >= totals.goal;
      if (isCompleted && !prevScaleCompletion[scale.id]) { scaleFinished = true; }
    });

    if (anyCrossed) ding(1);
    if (isAllCompleted && !wasAllCompleted) ding(2);
    if (scaleFinished) ding(3);

    UpdateTasksRender();
    Save(false);
  }
};

async function toggleTask(id, UITarget) {
  let task = state.tasks[id];
  if (!task) return; 
  
  timerWorker.postMessage('stop'); 
  
  if (task.running) {
    task.running = false;
    document.body.classList.remove("active")
    const user = auth.currentUser;
    if (user) {
      isSavingLocally = true;
      let updates = { 
        [`tasks/${task.id}/running`]: false,
        [`agenda`]: state.agenda
      };
      Object.keys(state.timeScales).forEach(scaleId => {
        if (!task.times) task.times = {};
        if (!task.times[scaleId]) task.times[scaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 };
        updates[`tasks/${task.id}/times/${scaleId}/elapsed`] = task.times[scaleId].elapsed;
      });
      update(ref(db, `users/${user.uid}`), updates);
    }
    
    await Save(false);
    UpdateTasksRender();
    RenderAgenda();
  } else {
    document.body.classList.add("active")
    Object.values(state.tasks).forEach((t) => {
      if (t.running) {
        t.running = false;
        const user = auth.currentUser;
        if (user) {
          isSavingLocally = true;
          let updates = { 
            [`tasks/${t.id}/running`]: false,
            [`agenda`]: state.agenda
          };
          Object.keys(state.timeScales).forEach(scaleId => {
            if (!t.times) t.times = {};
            if (!t.times[scaleId]) t.times[scaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 };
            updates[`tasks/${t.id}/times/${scaleId}/elapsed`] = t.times[scaleId].elapsed;
          });
          update(ref(db, `users/${user.uid}`), updates);
        }
      }
    });
    
    task.running = true;
    const user = auth.currentUser;
    if (user) {
      isSavingLocally = true;
      update(ref(db, `users/${user.uid}/tasks/${task.id}`), {
        running: true,
        startedAt: serverTimestamp()
      });
    }

    startTime = new Date().getTime();
    startCounters = JSON.parse(JSON.stringify(task.times));
    lastTime = startTime;

    UpdateTasksRender();
    UpdateTimeScalesRender();
    timerWorker.postMessage('start');
  }
}

function syncAgendaGap(taskId, gap) {
  if (gap === 0) return;
  let now = new Date().getTime();
  
  if (gap > 0) {
    let timeRemaining = gap * 1000;
    let timeMarker = now;
    while (timeRemaining > 0) {
      let markerDate = new Date(timeMarker);
      let minutes = Math.floor(markerDate.getMinutes() / 15) * 15;
      let slotStart = new Date(markerDate.getFullYear(), markerDate.getMonth(), markerDate.getDate(), markerDate.getHours(), minutes, 0, 0);
      let slotStartTime = slotStart.getTime();
      
      let timeInThisSlot;
      if (timeMarker === slotStartTime) { timeMarker -= 1; continue; }
      else { timeInThisSlot = Math.min(timeRemaining, timeMarker - slotStartTime); }
      
      let currentSlotIso = getSafeIsoString(slotStart);
      
      if (!state.agenda[currentSlotIso]) state.agenda[currentSlotIso] = { iso: currentSlotIso, busy: false, tasksWorked: {} };
      if (!state.agenda[currentSlotIso].tasksWorked) state.agenda[currentSlotIso].tasksWorked = {};
      
      state.agenda[currentSlotIso].tasksWorked[taskId] = (state.agenda[currentSlotIso].tasksWorked[taskId] || 0) + (timeInThisSlot / 1000);
      timeMarker -= timeInThisSlot;
      timeRemaining -= timeInThisSlot;
    }
  } else {
    let timeToRemove = Math.abs(gap);
    let sortedIsos = Object.keys(state.agenda).sort((a,b) => new Date(b).getTime() - new Date(a).getTime());
    
    for (let iso of sortedIsos) {
      if (timeToRemove <= 0) break;
      let block = state.agenda[iso];
      if (block.tasksWorked && block.tasksWorked[taskId] > 0) {
        let availableToRemove = block.tasksWorked[taskId];
        if (availableToRemove >= timeToRemove) {
          block.tasksWorked[taskId] -= timeToRemove;
          timeToRemove = 0;
        } else {
          timeToRemove -= availableToRemove;
          block.tasksWorked[taskId] = 0;
        }
      }
    }
  }
}

function snapSession(taskId) {
  let task = state.tasks[taskId];
  if (!task || !task.isHabit) return;

  if (task.running) {
    toggleTask(taskId, null);
  }

  let firstScaleId = Object.keys(state.timeScales)[0];
  let currentElapsed = task.times[firstScaleId].elapsed;

  Object.keys(state.timeScales).forEach(scaleId => {
    if(task.times[scaleId]) {
      let currentSessions = task.times[scaleId].sessions || 0;
      let newSessions = currentSessions + 1;
      task.times[scaleId].sessions = newSessions;
      task.times[scaleId].elapsed = newSessions * task.sessionDuration;
    }
  });

  let targetElapsed = task.times[firstScaleId].elapsed;
  let gap = targetElapsed - currentElapsed;

  syncAgendaGap(taskId, gap);
  
  Save(true);
  RenderTasks();
  RenderAgenda();
  UpdateTimeScalesRender();
}

window.snapSession = snapSession;

function moveTaskUp(id) {
  let tasksArray = Object.values(state.tasks).sort((a, b) => a.order - b.order);
  const index = tasksArray.findIndex(t => t.id === id);
  
  if (index > 0) {
    let currentTask = tasksArray[index];
    let prevTask = tasksArray[index - 1];
    
    let tempOrder = currentTask.order;
    state.tasks[currentTask.id].order = prevTask.order;
    state.tasks[prevTask.id].order = tempOrder;
    
    Save(true);
    RenderTasks();
  }
}

async function editTask(id) {
  await Load();
  let task = state.tasks[id];
  if (task.running){ window.alert("Please stop the task before editing it."); return; }
  
  let tasksArray = Object.values(state.tasks).sort((a, b) => a.order - b.order);
  let taskIndex = tasksArray.findIndex(t => t.id === id);
  
  document.getElementById("modal-title").innerText = "Edit Task";
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group">
      <label>Name <span style="color:red">*</span></label>
      <input type="text" id="modal-taskName" value="${task.name}">
    </div>
    
    <div class="form-group" style="margin: var(--spacing-lg) 0;">
      <label><input type="checkbox" id="modal-isHabit" ${task.isHabit ? 'checked' : ''} onchange="document.getElementById('habit-view').style.display = this.checked ? 'block' : 'none'; document.getElementById('standard-view').style.display = this.checked ? 'none' : 'block';"> Track by sessions</label>
    </div>

    <div id="habit-view" style="display: ${task.isHabit ? 'block' : 'none'};">
      <div class="form-group">
        <label>Time per session <span style="color:red">*</span></label>
        <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
          <input type="number" id="modal-session-h" value="${Math.floor((task.sessionDuration||1800)/3600)}" min="0" placeholder="HH" style="width: 55px;"> h
          <input type="number" id="modal-session-m" value="${Math.floor(((task.sessionDuration||1800)%3600)/60)}" min="0" max="59" placeholder="MM" style="width: 55px;"> m
          <input type="number" id="modal-session-s" value="${(task.sessionDuration||1800)%60}" min="0" max="59" placeholder="SS" style="width: 55px;"> s
        </div>
      </div>
      ${
        Object.values(state.timeScales).map(scale => {
          const ts = task.times[scale.id]?.targetSessions || 1;
          const currentSessions = task.times[scale.id]?.sessions || 0;
          return `
            <div style="display: flex; gap: 15px; margin-bottom: 10px;">
              <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label>${scale.name} Completed Sessions</label>
                <input type="number" id="modal-completed-${scale.id}" value="${currentSessions}" min="0" style="width: 100%;">
              </div>
              <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label>${scale.name} Target Sessions <span style="color:red">*</span></label>
                <input type="number" id="modal-target-${scale.id}" value="${ts}" min="0" style="width: 100%;">
              </div>
            </div>
          `;
        }).join("")
      }
    </div>

    <div id="standard-view" style="display: ${task.isHabit ? 'none' : 'block'};">
      ${
        Object.values(state.timeScales).map((scale) => {
          const elapsedSecs = task.times[scale.id]?.elapsed || 0;
          const eh = Math.floor(elapsedSecs / 3600);
          const em = Math.floor((elapsedSecs % 3600) / 60);
          const es = elapsedSecs % 60;

          const goalSecs = task.times[scale.id]?.goal || 0;
          const gh = Math.floor(goalSecs / 3600);
          const gm = Math.floor((goalSecs % 3600) / 60);
          const gs = goalSecs % 60;

          return `
            <div class="form-group">
              <label>${scale.name} (Elapsed / Goal) <span style="color:red">*</span></label>
              <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                <input type="number" id="modal-task-${scale.id}-elapsed-h" value="${eh}" min="0" placeholder="HH" style="width: 55px;"> h
                <input type="number" id="modal-task-${scale.id}-elapsed-m" value="${em}" min="0" max="59" placeholder="MM" style="width: 55px;"> m
                <input type="number" id="modal-task-${scale.id}-elapsed-s" value="${es}" min="0" max="59" placeholder="SS" style="width: 55px;"> s
                <span style="font-size: 24px; font-weight: bold; margin: 0 8px; color: #555;">/</span>
                <input type="number" id="modal-task-${scale.id}-goal-h" value="${gh}" min="0" placeholder="HH" style="width: 55px;"> h
                <input type="number" id="modal-task-${scale.id}-goal-m" value="${gm}" min="0" max="59" placeholder="MM" style="width: 55px;"> m
                <input type="number" id="modal-task-${scale.id}-goal-s" value="${gs}" min="0" max="59" placeholder="SS" style="width: 55px;"> s
              </div>
            </div>
          `;
        }).join("")
      }
    </div>
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
    if (!newName) { alert("Invalid input. Please try again."); return; }
    
    const newIsHabit = document.getElementById("modal-isHabit").checked;

    if (task.isHabit !== newIsHabit) {
      if (!window.confirm("Changing the task type will reset your current progress for this task. Are you sure you want to continue?")) {
        return;
      }
    }

    task.name = newName;
    task.isHabit = newIsHabit;

    if (task.isHabit) {
      const sh = parseInt(document.getElementById("modal-session-h").value) || 0;
      const sm = parseInt(document.getElementById("modal-session-m").value) || 0;
      const ss = parseInt(document.getElementById("modal-session-s").value) || 0;
      task.sessionDuration = (sh * 3600) + (sm * 60) + ss;

      Object.values(state.timeScales).forEach(scale => {
        const targetSessions = parseInt(document.getElementById(`modal-target-${scale.id}`).value) || 0;
        const completedSessions = parseInt(document.getElementById(`modal-completed-${scale.id}`).value) || 0;

        task.times[scale.id].targetSessions = targetSessions;
        task.times[scale.id].sessions = completedSessions;
        task.times[scale.id].goal = targetSessions * task.sessionDuration;
        
        let targetElapsed = completedSessions * task.sessionDuration;
        if (!task.running) task.times[scale.id].elapsed = targetElapsed;
      });

    } else {
      try {
        task.times = Object.values(state.timeScales).reduce((acc, scale) => {
          const eh = parseInt(document.getElementById(`modal-task-${scale.id}-elapsed-h`).value) || 0;
          const em = parseInt(document.getElementById(`modal-task-${scale.id}-elapsed-m`).value) || 0;
          const es = parseInt(document.getElementById(`modal-task-${scale.id}-elapsed-s`).value) || 0;
          const gh = parseInt(document.getElementById(`modal-task-${scale.id}-goal-h`).value) || 0;
          const gm = parseInt(document.getElementById(`modal-task-${scale.id}-goal-m`).value) || 0;
          const gs = parseInt(document.getElementById(`modal-task-${scale.id}-goal-s`).value) || 0;

          if (eh < 0 || em < 0 || es < 0 || gh < 0 || gm < 0 || gs < 0) throw new Error("Negative values");

          acc[scale.id] = {
            ...task.times[scale.id],
            elapsed: (eh * 3600) + (em * 60) + es,
            goal: (gh * 3600) + (gm * 60) + gs
          };
          return acc;
        }, {});
      } catch (error) { alert("Invalid time input."); return; }
    }

    const user = auth.currentUser;
    if (user) {
      isSavingLocally = true;
      update(ref(db, `users/${user.uid}/tasks/${task.id}`), { name: task.name, times: task.times, isHabit: task.isHabit, sessionDuration: task.sessionDuration });
      Save(false);
    } else { Save(true); }
    RenderTasks(); RenderTimeScales(); closeModal("modal");
  }
  openModal("modal");
}

function deleteTask(id) {
  if (state.tasks[id] && window.confirm(`Are you sure you want to delete "${state.tasks[id].name}"`)) {
    delete state.tasks[id];
  }
  Save(true); RenderTimeScales(); RenderTasks(); RenderAgenda(); closeModal("modal")
}

function createNewSubtask(taskId) {
  let task = state.tasks[taskId];
  let subtaskName = prompt("What do you need to do?");
  
  if (subtaskName && subtaskName.trim() !== "") {
    let subtaskId = crypto.randomUUID();
    task.subtasks[subtaskId] = { id: subtaskId, name: subtaskName, done: false };
    Save(true); RenderTasks();
  }
}

function toggleSubtask(taskId, subtaskId) {
  let task = state.tasks[taskId];
  let subtask = task.subtasks[subtaskId];

  subtask.done = !subtask.done;

  if (subtask.done) {
    subtask.deleteTimeout = setTimeout(() => {
      if (task.subtasks[subtaskId]) {
        deleteSubtask(taskId, subtaskId);
      }
    }, 5000);
  } else {
    clearTimeout(subtask.deleteTimeout);
  }
  
  const user = auth.currentUser;
  if (user) {
    isSavingLocally = true;
    let cleanSubtasks = {};
    Object.values(task.subtasks).forEach((st) => {
      let { deleteTimeout, ...cleanSubtask } = st;
      cleanSubtasks[st.id] = cleanSubtask;
    });
    update(ref(db, `users/${user.uid}/tasks/${task.id}`), { subtasks: cleanSubtasks });
    Save(false);
  } else { Save(true); }
  RenderTasks();
}

function deleteSubtask(taskId, subtaskId) {
  delete state.tasks[taskId].subtasks[subtaskId];
  Save(true); RenderTasks();
}

function RenderTasks() {
  const container = document.getElementById("root-tasks");
  let firstRender = container.innerHTML == '';
  const sortedTasks = Object.values(state.tasks).sort((a, b) => a.order - b.order);

  container.innerHTML = `
    <h3>To-do List</h3>
    <div id="task-list-container">
      <div class="task" style="text-align: center; cursor: pointer;" onclick="createNewTask()">+ New Task</div>
      ${sortedTasks.map((task)=>{
        return `
          <div class="task ${task.running ? "active" : ""}" style="cursor: pointer;" onclick="if (event.target.classList.contains('edit-icon') || event.target.closest('.subtask-area') || event.target.classList.contains('btn-snap')) { return; } toggleTask('${task.id}', this)">
            <div class="task-main-content">
              <div class="task-title-row">
                <h3 class="task-title">${task.name}</h3>
                <div style="display: flex; gap: 10px;">
                  ${task.isHabit ? `<button class="btn btn-primary btn-sm btn-snap" onclick="snapSession('${task.id}'); event.stopPropagation();">+1</button>` : ''}
                  <div class="task-actions edit-icon" onclick="editTask('${task.id}')">⚙</div>
                </div>
              </div>
              <div class="subtask-area" style="margin: 15px 0;">
                <div class="task" style="text-align: center; cursor: pointer; padding: 5px; font-size: 0.9em; margin-bottom: 10px;" onclick="createNewSubtask('${task.id}')">+ New subtask</div>
                ${Object.values(task.subtasks).map((subtask)=>{
                  let isChecked = subtask.done ? 'checked' : '';
                  let textStyle = subtask.done ? 'text-decoration: line-through; opacity: 0.6;' : '';
                  let classname = subtask.done ? "task subtask-done" : "task";
                  return `<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;" class="${classname}">
                      <input type="checkbox" ${isChecked} onclick="toggleSubtask('${task.id}', '${subtask.id}')"> 
                      <span style="font-weight: 500; ${textStyle}">${subtask.name}</span>
                  </div>`
                }).join("")}
              </div>
              <div class="task-progress-list">
                ${Object.values(state.timeScales).map((scale)=>{
                  if (!task.times[scale.id] || task.times[scale.id].goal <= 0) return "";
                  const progress = !firstRender ? (task.times[scale.id].elapsed / task.times[scale.id].goal) * 100 : 0;
                  
                  let labelMiddle = `${progress.toFixed(1)}%`;
                  let labelRight = `${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(task.times[scale.id].goal * 1000).toISOString().substring(11, 19)}`;
                  if (task.isHabit) {
                    labelMiddle = `Sessions: ${task.times[scale.id].sessions} / ${task.times[scale.id].targetSessions}`;
                    labelRight = `${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)}`;
                  } else {
                    labelRight += ` (${new Date(Math.max(0, task.times[scale.id].goal - task.times[scale.id].elapsed) * 1000).toISOString().substring(11, 19)} left)`;
                  }

                  return `
                    <div class="task-progress-row" data-scale-id="${scale.id}" data-task-id="${task.id}">
                      <div class="task-progress-meta">
                        <span>${scale.name}</span>
                        <span>${labelMiddle}</span>
                        <span>${labelRight}</span>
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
      }).join("")}
    </div>
  `
  if (firstRender){ requestAnimationFrame(() => { requestAnimationFrame(() => { UpdateTasksRender(); }); }); }
}

function UpdateTasksRender() {
  const taskContainers = document.querySelectorAll("#task-list-container > .task:not([onclick='createNewTask()'])");
  const sortedTasks = Object.values(state.tasks).sort((a, b) => a.order - b.order);
  
  taskContainers.forEach((taskContainer, index) => {
    let task = sortedTasks[index];
    if (!task) return;

    if (task.running) taskContainer.classList.add("active"); else taskContainer.classList.remove("active");

    let progressRows = taskContainer.querySelectorAll(".task-progress-row");

    progressRows.forEach((row) => {
      let scaleId = row.getAttribute("data-scale-id");
      let scale = state.timeScales[scaleId];
      if (!scale || !task.times[scale.id]) return;

      const progress = task.times[scale.id].goal > 0 ? (task.times[scale.id].elapsed / task.times[scale.id].goal) * 100 : 0;
      let metaSpans = row.querySelectorAll(".task-progress-meta span");
      if (metaSpans.length >= 3) {
        if (task.isHabit) {
          metaSpans[1].textContent = `Sessions: ${task.times[scale.id].sessions} / ${task.times[scale.id].targetSessions}`;
          metaSpans[2].textContent = `${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)}`;
        } else {
          metaSpans[1].textContent = `${progress.toFixed(1)}%`;
          metaSpans[2].textContent = `${new Date(task.times[scale.id].elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(task.times[scale.id].goal * 1000).toISOString().substring(11, 19)} (${new Date(Math.max(0, task.times[scale.id].goal - task.times[scale.id].elapsed) * 1000).toISOString().substring(11, 19)} left)`;
        }
      }
      let progressBarFill = row.querySelector(".progress-bar-fill");
      if (progressBarFill) progressBarFill.style.width = `${Math.min(100, progress)}%`;
    });
  });
}

function addTimeScale() {
  let dateTemp = new Date(); dateTemp.setHours(0, 0, 0, 0);
  const newScaleId = crypto.randomUUID();
  state.timeScales[newScaleId] = { id: newScaleId, name: "New time scale", duration: 1, start: dateTemp.toDateString() };

  let runningTask = null;
  Object.values(state.tasks).forEach((task) => {
    if (!task.times) task.times = {};
    task.times[newScaleId] = { elapsed: 0, goal: 3600, sessions: 0, targetSessions: 1 };
    if (task.isHabit) {
        task.times[newScaleId].goal = task.times[newScaleId].targetSessions * task.sessionDuration;
    }
    if (task.running) runningTask = task;
  });

  if (runningTask) {
    startTime = new Date().getTime();
    startCounters = JSON.parse(JSON.stringify(runningTask.times));
  }
  Save(true); RenderTimeScales(); RenderTasks(); RenderAgenda();
}

async function editTimeScale(id) {
  await Load()
  const scale = state.timeScales[id];
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
      scale.start = new Date(newStart + "T00:00:00").toISOString(); 
      Save(true); RenderTimeScales(); RenderTasks(); RenderAgenda(); closeModal("modal");
    } else { alert("Invalid input."); }
  }
  openModal("modal");
}

function deleteTimeScale(id) {
  if (state.timeScales[id] && window.confirm(`Are you sure you want to delete "${state.timeScales[id].name}"`)) {
    delete state.timeScales[id];
    Object.values(state.tasks).forEach(task => { if (task.times && task.times[id]) delete task.times[id]; });
  }
  Save(true); RenderTimeScales(); RenderTasks(); RenderAgenda(); closeModal("modal");
}

function formatDuration(ms) {
  let output = ms < 0 ? "-" : ""
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  return days > 0 ? output + `${days.toString().padStart(2, "0")}:${formattedTime}` : output + formattedTime;
}

function getTimeScaleStreak(scaleId) {
  const scaleStats = Object.values(state.statistics)
    .filter(stat => stat.scaleId === scaleId)
    .sort((a,b) => new Date(b.start) - new Date(a.start)); 

  let streakInScales = 0;
  for (const stat of scaleStats) {
    const cappedTotalWorked = stat.tasks.reduce((sum, task) => {
      return sum + Math.min(Number(task.elapsed) || 0, Number(task.goal) || 0);
    }, 0);
    if (stat.goal === 0 || cappedTotalWorked >= stat.goal) { streakInScales++; } 
    else { break; }
  }
  return streakInScales;
}

let isEditingAgenda = false;

function RenderTimeScales(agendaData = state.agenda) {
  if (checkTimeScaleDone()) return;
  const container = document.getElementById("root-time-scales");
  container.innerHTML = `
    <h3>Time Scales</h3>
    <div id="time-scale-list-container">
      <div class="time-scale" style="text-align: center; cursor: pointer;" onclick="addTimeScale()">+ New Time Scale</div>
      ${Object.values(state.timeScales).map((scale)=>{
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
              <div onclick="openTimeScaleStatistics('${scale.id}')" class="stats-icon" style="cursor: pointer;">📊</div>
              <div onclick="editTimeScale('${scale.id}')" class="edit-icon" style="cursor: pointer;">⚙</div>
            </div>
            <div>Duration: ${scale.duration} day${scale.duration !== 1 ? "s" : ""}</div>
            <div>
              ${scale.duration != 1 ? `<div>Start: ${new Date(scale.start).toLocaleDateString('en-GB')}</div><div>End: ${new Date(new Date(scale.start).getTime() + (scale.duration-1) * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}</div>` : `<div>Date: ${new Date(scale.start).toLocaleDateString('en-GB')}</div>`}
            </div>
            <div class="time-scale-progress-section">
              <div class="time-scale-progress-block">
                <div class="time-scale-progress-meta"><span>Tasks</span><span></span><span></span></div>
                <div class="progress-bar"><div class="progress-bar-fill" style="width: 0%;"></div></div>
              </div>
              <div class="time-scale-progress-block">
                <div class="time-scale-progress-meta"><span>Free time used</span><span></span><span></span></div>
                <div class="progress-bar"><div class="progress-bar-fill" style="width: 0%;"></div></div>
              </div>
              <div class="time-scale-progress-block">
                <div class="time-scale-progress-meta"><span>Time</span><span></span><span></span></div>
                <div class="progress-bar"><div class="progress-bar-fill" style="width: 0%;"></div></div>
              </div>
            </div>
          </div>
        `
      }).join("")}
    </div>
  `
  requestAnimationFrame(() => { requestAnimationFrame(() => { UpdateTimeScalesRender(agendaData); }); });
}

let hasRungToday = false;

function getWorkableTimeBetween(startMs, endMs) {
  if (endMs <= startMs) return 0;
  const rawTimeMs = endMs - startMs;
  const slotDurationMs = 15 * 60 * 1000;
  let busyTimeMs = 0;

  Object.values(state.agenda).forEach(block => {
    if (block.busy && block.iso) {
      const blockStartMs = new Date(block.iso).getTime();
      const blockEndMs = blockStartMs + slotDurationMs;
      if (blockEndMs > startMs && blockStartMs < endMs) {
        busyTimeMs += (Math.min(endMs, blockEndMs) - Math.max(startMs, blockStartMs));
      }
    }
  });
  return Math.max(0, rawTimeMs - busyTimeMs);
}

function getRequiredWorkByDeadlineMs(targetEndMs) {
  let totalRequiredMs = 0;
  Object.values(state.tasks).forEach(task => {
    let maxTaskRequiredForDeadlineMs = 0;
    Object.values(state.timeScales).forEach(scale => {
      const scaleEndMs = new Date(scale.start).getTime() + (scale.duration * 24 * 60 * 60 * 1000);
      const goal = Number(task.times[scale.id]?.goal) || 0;
      const elapsed = Number(task.times[scale.id]?.elapsed) || 0;
      const remainingTaskMs = Math.max(0, (goal - elapsed) * 1000);

      if (remainingTaskMs > 0) {
        let requiredForTaskMs = scaleEndMs <= targetEndMs ? remainingTaskMs : Math.max(0, remainingTaskMs - getWorkableTimeBetween(targetEndMs, scaleEndMs));
        if (requiredForTaskMs > maxTaskRequiredForDeadlineMs) maxTaskRequiredForDeadlineMs = requiredForTaskMs;
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
        document.getElementById("modal-body").innerHTML = `<p>Time to start working on your tasks!</p><p>You have less than 5 minutes of free time left today.</p>`;
        document.getElementById("btn-submit").innerText = "I'll start working!";
        document.getElementById("btn-submit").onclick = function() { closeModal("modal"); };
        openModal("modal");
        hasRungToday = true;
      }
    } else if (wiggleRoomTodayMs > 5 * 60 * 1000) { hasRungToday = false; }
  } else { hasRungToday = false; }

  timeScaleContainers.forEach((timeScaleContainer) => {
    let header = timeScaleContainer.querySelector(".time-scale-header > h3");
    if (!header) return;

    let scale = Object.values(state.timeScales).find((s) => s.name === header.textContent);
    if (!scale) return;

    const totals = Object.values(state.tasks).reduce((acc, task) => {
      acc.elapsed += Math.min(Number(task.times[scale.id]?.elapsed) || 0, Number(task.times[scale.id]?.goal) || 0);
      acc.goal += Number(task.times[scale.id]?.goal) || 0;
      return acc;
    }, { elapsed: 0, goal: 0 });

    const taskPercentage = totals.goal > 0 ? (totals.elapsed / totals.goal) * 100 : 100;
    const currentTime = Date.now();
    const startTimeMs = new Date(scale.start).getTime() || currentTime;
    const durationDays = Number(scale.duration) || 0;
    const rawTotalTimeMs = durationDays * 24 * 60 * 60 * 1000;
    const slotDurationMs = 15 * 60 * 1000;
    const scaleEndMs = startTimeMs + rawTotalTimeMs;

    let totalExcludedTimeMs = 0; let passedExcludedTimeMs = 0;
    Object.values(agendaData).forEach(block => {
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
    const rawElapsedMs = Object.values(state.tasks).reduce((sum, task) => sum + (Number(task.times[scale.id]?.elapsed) || 0) * 1000, 0);
    const freeTimeUsedMs = Math.max(0, timeUsed - rawElapsedMs);
    const initialFreeTimeMs = currentFreeTimeMs + freeTimeUsedMs;
    const freeTimeUsedPercentage = initialFreeTimeMs > 0 ? Math.min(100, Math.max(0, (freeTimeUsedMs / initialFreeTimeMs) * 100)) : (freeTimeUsedMs > 0 ? 100 : 0);
    const timePercentage = (totalTimeMs > 0 && !isNaN(timeUsed)) ? Math.min(100, Math.max(0, (timeUsed / totalTimeMs) * 100)) : 0;

    let blocks = timeScaleContainer.querySelectorAll(".time-scale-progress-block");
    blocks.forEach((block) => {
      let meta_info = block.querySelector(".time-scale-progress-meta");
      let progressBarFill = block.querySelector(".progress-bar-fill");
      let label = meta_info.children[0].textContent.trim();

      switch (label) {
        case "Tasks":
          meta_info.children[1].textContent = `${taskPercentage.toFixed(1)}%`;
          meta_info.children[2].textContent = `${new Date(totals.elapsed * 1000).toISOString().substring(11, 19)} / ${new Date(totals.goal * 1000).toISOString().substring(11, 19)} (${new Date(Math.max(0, totals.goal - totals.elapsed) * 1000).toISOString().substring(11, 19)} left)`;
          progressBarFill.style.width = `${Math.min(100, taskPercentage)}%`;
          break;
        case "Free time used":
          meta_info.children[1].textContent = `${freeTimeUsedPercentage.toFixed(1)}%`;
          const wiggleRoomStr = currentFreeTimeMs < 0 ? `-${formatDuration(Math.abs(currentFreeTimeMs))}` : formatDuration(currentFreeTimeMs);
          meta_info.children[2].textContent = `${formatDuration(freeTimeUsedMs)} / ${formatDuration(initialFreeTimeMs)} (${wiggleRoomStr} left)`;
          progressBarFill.style.width = `${Math.min(100, freeTimeUsedPercentage)}%`;
          progressBarFill.style.backgroundColor = currentFreeTimeMs < 0 ? "darkred" : "";
          break;
        case "Time":
          meta_info.children[1].textContent = `${timePercentage.toFixed(1)}%`;
          meta_info.children[2].textContent = `${formatDuration(timeUsed)} / ${formatDuration(totalTimeMs)} (${formatDuration(Math.max(0, totalTimeMs - timeUsed))} left)`;
          progressBarFill.style.width = `${Math.min(100, timePercentage)}%`;
          break;
      }
    });
  });
}

let lastTick = performance.now();
let timeScalesRenderInterval = setInterval(()=>{
  let now = performance.now();
  if (now - lastTick > 5000) hasSyncedWithFirebase = false;
  lastTick = now;
  UpdateTimeScalesRender();
}, 1000);

function resetTimes(){
  let dateTemp = new Date(); dateTemp.setHours(0, 0, 0, 0);
  Object.values(state.timeScales).forEach((scale)=>{ scale.start = dateTemp.toISOString() })

  let runningTask = null;
  Object.values(state.tasks).forEach((task)=>{
    Object.keys(task.times).forEach((scaleId)=>{ 
        task.times[scaleId].elapsed = 0;
        task.times[scaleId].sessions = 0;
    })
    if (task.running) runningTask = task;
  })

  if (runningTask) {
    startTime = new Date().getTime();
    startCounters = JSON.parse(JSON.stringify(runningTask.times));
  } else { startCounters = null; }

  Save(true); RenderTasks(); RenderTimeScales(); RenderAgenda();
}

const getCellBgStyles = (busy, totalSecondsWorked, isToday) => {
  const hasWork = totalSecondsWorked > 0;
  const percent = hasWork ? Math.min(1, totalSecondsWorked / 900) : 0;
  const greenColor = `rgba(76, 255, 80, ${(percent * 0.8) + 0.2})`;
  let styles = {};

  if (busy && hasWork) { styles = { background: `linear-gradient(135deg, lightcoral 30%, ${greenColor} 70%)`, backgroundColor: '' }; } 
  else if (busy) { styles = { background: '', backgroundColor: 'lightcoral' }; } 
  else if (hasWork) { styles = { background: '', backgroundColor: greenColor }; } 
  else { styles = { background: '', backgroundColor: 'transparent' }; }
  
  if (isToday) { styles.borderLeft = '4px solid lightcoral'; styles.borderRight = '4px solid lightcoral'; }
  return styles;
};

function RenderAgenda() { 
  const container = document.getElementById("root-agenda");
  
  const earliestStart = Object.values(state.timeScales).reduce((min, scale) => {
    const scaleStart = new Date(scale.start).getTime();
    return scaleStart < min ? scaleStart : min;
  }, Infinity);

  const baseDate = new Date(earliestStart); baseDate.setHours(0, 0, 0, 0);
  const todayStr = new Date().toDateString();
  const getTimestamp = (dayOffset, timeOffset) => baseDate.getTime() + (dayOffset * 24 * 60 * 60 * 1000) + (timeOffset * 15 * 60 * 1000);

  container.innerHTML = `
    <h3>Agenda</h3>
    <table id="agenda-table" style="user-select: none;">
      ${(() => {
        const longestScaleLengthDays = Object.values(state.timeScales).reduce((max, scale) => Math.max(max, scale.duration), 0);
        let html_output = '';
        const headerCells = ['<th class="agenda-top-left-empty"></th>'];

        for (let j = 0; j < longestScaleLengthDays; j++) {
          const currentDate = new Date(baseDate.getTime() + j * 24 * 60 * 60 * 1000);
          headerCells.push(`<th class="agenda-date-header">${currentDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</th>`);
        }
        html_output += `<tr>${headerCells.join("")}</tr>`;

        for (let i = 0; i < 24 * 4; i++) {
          const isFullHour = i % 4 === 0;
          const timeLabel = new Date(0, 0, 0, Math.floor(i / 4), (i % 4) * 15).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          const rowCells = [`<td class="agenda-time-label ${isFullHour ? "agenda-time-label-full-hour" : ""}">${isFullHour ? timeLabel : ""}</td>`];

          for (let j = 0; j < longestScaleLengthDays; j++) {
            const timestamp = getTimestamp(j, i);
            const isoString = getSafeIsoString(new Date(timestamp));
            const isToday = new Date(timestamp).toDateString() === todayStr;
            
            const agendaItem = state.agenda[isoString];
            let totalSecondsWorked = 0; let busy = false;
            if (agendaItem) {
              busy = agendaItem.busy;
              if (agendaItem.tasksWorked) totalSecondsWorked = Object.values(agendaItem.tasksWorked).reduce((sum, val) => sum + val, 0);
            }
            
            const bg = getCellBgStyles(busy, totalSecondsWorked, isToday);
            let inlineStyleStr = bg.background ? `background: ${bg.background};` : `background-color: ${bg.backgroundColor};`;
            if (bg.borderLeft) inlineStyleStr += ` border-left: ${bg.borderLeft}; border-right: ${bg.borderRight};`;
            
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
  const existingSlot = state.agenda[iso];
  return { day, time, iso, busy: existingSlot ? existingSlot.busy : false };
}

const isinBox = (target, side1, side2) => {
  return (target.day >= Math.min(side1.day, side2.day) && target.day <= Math.max(side1.day, side2.day) && target.time >= Math.min(side1.time, side2.time) && target.time <= Math.max(side1.time, side2.time))
}

const updatePreview = (startCellData, currentHoverData) => {
  document.querySelectorAll('.agenda-cell').forEach(cell => {
    const cellData = getDataFromCell(cell);
    const existingSlot = state.agenda[cellData.iso];
    const totalSecondsWorked = (existingSlot && existingSlot.tasksWorked) ? Object.values(existingSlot.tasksWorked).reduce((sum, val) => sum + val, 0) : 0;
    const isToday = new Date(cellData.iso).toDateString() === new Date().toDateString();
    let bg;
    if (startCellData && currentHoverData) bg = getCellBgStyles(isinBox(cellData, startCellData, currentHoverData) ? !startCellData.busy : cellData.busy , totalSecondsWorked, isToday);
    else bg = getCellBgStyles(cellData.busy, totalSecondsWorked, isToday)
    cell.style.background = bg.background;
    cell.style.backgroundColor = bg.backgroundColor;
  });
};

function buildAgendaSelector() {
  const table = document.getElementById("agenda-table");
  let startCellData = null; let currentHoverData = null;

  const getPreviewAgenda = (start, current) => {
    let previewAgenda = JSON.parse(JSON.stringify(state.agenda));
    document.querySelectorAll('.agenda-cell').forEach(cell => {
      const cellData = getDataFromCell(cell);
      if (isinBox(cellData, start, current)) {
        if (!start.busy) {
          if (previewAgenda[cellData.iso]) previewAgenda[cellData.iso].busy = true;
          else previewAgenda[cellData.iso] = { iso: cellData.iso, busy: true, tasksWorked: {} };
        } else {
          if (previewAgenda[cellData.iso]) previewAgenda[cellData.iso].busy = false;
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

  if (window.agendaMouseUpHandler) document.removeEventListener("mouseup", window.agendaMouseUpHandler);

  window.agendaMouseUpHandler = () => {
    if (startCellData && currentHoverData) {
      document.querySelectorAll('.agenda-cell').forEach(cell => {
        const cellData = getDataFromCell(cell);
        if (isinBox(cellData, startCellData, currentHoverData)) {
          let existingItem = state.agenda[cellData.iso];
          if (!startCellData.busy) {
            if (existingItem) existingItem.busy = true;
            else state.agenda[cellData.iso] = { iso: cellData.iso, busy: true, tasksWorked: {} };
          } else {
            if (existingItem) existingItem.busy = false;
          }
        }
      });
      startCellData = null; currentHoverData = null; isEditingAgenda = false;
      Save(true); UpdateTimeScalesRender(); updatePreview();
    }
  };
  document.addEventListener("mouseup", window.agendaMouseUpHandler);
}

function checkTimeScaleDone() {
  if (!hasSyncedWithFirebase) return false;
  let SomethingChanged = false;
  let nowMs = new Date().getTime();

  Object.values(state.timeScales).forEach((scale) => {
    const scaleDurationMs = scale.duration * 24 * 60 * 60 * 1000;
    let scaleStartMs = new Date(scale.start).getTime();
    
    if (scaleStartMs + scaleDurationMs <= nowMs) {
      SomethingChanged = true;
      let isFirstMissedCycle = true;

      while (scaleStartMs + scaleDurationMs <= nowMs) {
        const totals = Object.values(state.tasks).reduce((acc, task) => {
          acc.elapsed += isFirstMissedCycle ? (Number(task.times[scale.id]?.elapsed) || 0) : 0; 
          acc.goal += Number(task.times[scale.id]?.goal) || 0;
          return acc;
        }, { elapsed: 0, goal: 0 });

        const statId = crypto.randomUUID();
        state.statistics[statId] = {
          id: statId,
          scaleId: scale.id,
          name: scale.name,
          timeWorked: totals.elapsed,
          goal: totals.goal,
          duration: scale.duration,
          start: new Date(scaleStartMs).toISOString(),
          tasks: Object.values(state.tasks).map((task) => {
            return { 
              id: task.id, 
              name: task.name, 
              elapsed: isFirstMissedCycle ? (task.times[scale.id]?.elapsed || 0) : 0, 
              goal: task.times[scale.id]?.goal || 0 
            }
          })
        };

        scaleStartMs += scaleDurationMs;
        isFirstMissedCycle = false;
      }

      let finalDate = new Date(scaleStartMs);
      finalDate.setHours(0, 0, 0, 0);
      scale.start = finalDate.toISOString();
      
      let runningTask = null;
      Object.values(state.tasks).forEach((task) => {
        if (task.times && task.times[scale.id]) {
            task.times[scale.id].elapsed = 0;
            task.times[scale.id].sessions = 0;
        }
        if (task.running) runningTask = task;
      });

      if (runningTask) {
        startTime = new Date().getTime();
        startCounters = JSON.parse(JSON.stringify(runningTask.times));
      }
    }
  });

  if (SomethingChanged) { 
    Save(true); 
    RenderTasks(); 
    RenderTimeScales(); 
    RenderAgenda(); 
  }
  
  return SomethingChanged;
}


function openTimeScaleStatistics(scaleId) {
  const scaleStats = Object.values(state.statistics)
    .filter(stat => stat.scaleId === scaleId)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  
  
  const currentScale = state.timeScales[scaleId];
  if (currentScale) {
    scaleStats.push({
      id: 'preview',
      scaleId: currentScale.id,
      name: currentScale.name + " (Ongoing)",
      duration: currentScale.duration,
      start: currentScale.start,
      isPreview: true,
      tasks: Object.values(state.tasks).map(task => {
        return { 
          id: task.id, 
          name: task.name, 
          elapsed: task.times[scaleId]?.elapsed || 0, 
          goal: task.times[scaleId]?.goal || 0 
        };
      })
    });
  }
 
  
  if (scaleStats.length === 1 && scaleStats[0].isPreview) {
    document.getElementById("modal-title").innerText = "Statistics";
    document.getElementById("modal-body").innerHTML = `
      <div style="text-align: center; color: #666; padding: 30px 10px;">
        <div style="font-size: 2em; margin-bottom: 10px;">📊</div>
        No statistics available yet.<br>Complete a cycle for this time scale to see your history!
      </div>
    `;
  } else {
    const STATS_PER_ROW = 14;
    const scaleName = currentScale ? currentScale.name : scaleStats[0].name;
    document.getElementById("modal-title").innerText = `Statistics for ${scaleName}`;

    const remainder = scaleStats.length % STATS_PER_ROW;
    const emptySlotsCount = remainder === 0 ? 0 : STATS_PER_ROW - remainder;

    const styleBlock = `
      <style>
        .heatmap-square { cursor: pointer; transition: transform 0.1s; }
        .heatmap-square:hover { transform: scale(1.1); box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 10; }
        
        #global-heatmap-tooltip {
          position: fixed; pointer-events: none; z-index: 99999;
          background: #fff; border: 1px solid #ccc; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
          width: 280px; padding: 15px; border-radius: 8px;
          color: #333; text-align: left; opacity: 0; transition: opacity 0.15s ease;
        }
        
        .tt-progress-bar { width: 100%; background-color: #eee; border-radius: 4px; height: 8px; overflow: hidden; margin: 4px 0 10px 0; }
        .tt-progress-fill { height: 100%; transition: width 0.3s; }
        .tt-task-row { display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 2px; align-items: flex-end; }
      </style>
    `;

    document.getElementById("modal-body").innerHTML = `
      ${styleBlock}
      <div id="modal-statistics-container" style="max-height: 60vh; overflow-y: auto; display: grid; grid-template-columns: repeat(${STATS_PER_ROW}, 1fr); gap: 5px; padding: 5px;">
        ${
          scaleStats.map((stat, index)=>{
            let totals = stat.tasks.reduce((acc, task) => {
              acc.elapsed += Math.min(Number(task.elapsed) || 0, Number(task.goal) || 0);
              acc.goal += Number(task.goal) || 0;
              return acc;
            }, { elapsed: 0, goal: 0 });
            
            let percentage = totals.goal > 0 ? (totals.elapsed / totals.goal) * 100 : 100;
            let clampedPercentage = Math.min(100, Math.max(0, percentage));
            let hue = (clampedPercentage / 100) * 120;
            
            
            let borderStyle = stat.isPreview ? "dashed" : "solid";
            let borderColor = percentage >= 100 ? "hsl(120, 100%, 45%)" : "hsl(0, 100%, 45%)";
            let opacity = stat.isPreview ? "0.6" : "1";

            return `
              <div 
              class="heatmap-square time-scale" 
              data-index="${index}"
              style="margin: 0; border-radius: 6px; border: 2px ${borderStyle} ${borderColor}; background-color: hsl(${hue}, 100%, 45%); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15); aspect-ratio: 1; opacity: ${opacity};">
              </div>
            `
          }).join("")
        }
        ${
          Array.from({ length: emptySlotsCount }).map(() => `
            <div style="margin: 0; border-radius: 6px; background-color: #f0f0f0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05); aspect-ratio: 1;"></div>
          `).join("")
        }
      </div>
    `; 

    let tooltip = document.getElementById("global-heatmap-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "global-heatmap-tooltip";
      document.body.appendChild(tooltip);
    }
    
    const squares = document.querySelectorAll(".heatmap-square");
    
    squares.forEach(square => {
      square.addEventListener("mouseenter", (e) => {
        const index = e.target.getAttribute("data-index");
        const stat = scaleStats[index];
        
        let totals = stat.tasks.reduce((acc, task) => {
          acc.elapsed += Math.min(Number(task.elapsed) || 0, Number(task.goal) || 0);
          acc.goal += Number(task.goal) || 0; return acc;
        }, { elapsed: 0, goal: 0 });
        
        let percentage = totals.goal > 0 ? (totals.elapsed / totals.goal) * 100 : 100;
        let hue = (Math.min(100, Math.max(0, percentage)) / 100) * 120;
        
        const startStr = new Date(stat.start).toLocaleDateString('en-GB');
        const endStr = new Date(new Date(stat.start).getTime() + (stat.duration-1) * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB');
        const dateRange = stat.duration === 1 ? startStr : `${startStr} - ${endStr}`;

        const tasksHtml = stat.tasks.sort((a, b) => b.elapsed - a.elapsed).map(task => {
          const taskGoal = Number(task.goal) || 0;
          if (taskGoal <= 0) return "";
          const taskElapsed = Number(task.elapsed) || 0;
          const taskProgress = (taskElapsed / taskGoal) * 100;
          const taskHue = (Math.min(100, taskProgress) / 100) * 120;
          
          return `
            <div class="tt-task-row">
              <span style="font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 140px;">${task.name}</span>
              <span style="color: #666;">
                ${formatDuration(taskElapsed * 1000)} / ${formatDuration(taskGoal * 1000)} 
                <strong style="color:#333; margin-left: 5px;">${taskProgress.toFixed(1)}%</strong>
              </span>
            </div>
            <div class="tt-progress-bar">
              <div class="tt-progress-fill" style="width: ${Math.min(100, taskProgress)}%; background-color: hsl(${taskHue}, 100%, 45%);"></div>
            </div>
          `;
        }).join("");

        tooltip.innerHTML = `
          <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 6px;">
            ${stat.name} <span style="color: #666; font-size: 0.85em; font-weight: normal; float: right; margin-top: 2px;">${dateRange}</span>
          </div>
          <div class="tt-task-row" style="font-weight: bold; margin-top: 10px;">
            <span>Total Completion</span>
            <span>${formatDuration(totals.elapsed * 1000)} / ${formatDuration(totals.goal * 1000)} <span style="margin-left: 5px;">${percentage.toFixed(1)}%</span></span>
          </div>
          <div class="tt-progress-bar" style="margin-bottom: 15px; height: 10px;">
            <div class="tt-progress-fill" style="width: ${Math.min(100, percentage)}%; background-color: hsl(${hue}, 100%, 45%);"></div>
          </div>
          <div style="color: #999; margin-bottom: 6px; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.5px;">Task Breakdown</div>
          ${tasksHtml}
        `;
        
        tooltip.style.opacity = "1";
      });

      square.addEventListener("mousemove", (e) => {
        const tooltipWidth = tooltip.offsetWidth || 310; 
        const tooltipHeight = tooltip.offsetHeight || 150;

        let x = e.clientX - (tooltipWidth / 2);
        let y = e.clientY - tooltipHeight - 15;
        
        if (x < 10) x = 10;
        if (x + tooltipWidth > window.innerWidth - 10) x = window.innerWidth - tooltipWidth - 10;
        
        if (y < 10) {
           y = e.clientY + 20; 
        }

        tooltip.style.left = x + "px";
        tooltip.style.top = y + "px";
      });

      square.addEventListener("mouseleave", () => {
        tooltip.style.opacity = "0";
      });
    });
  }


  document.getElementById("modal-cancel").style.display = "none";
  document.getElementById("btn-submit").innerText = "Close";
  document.getElementById("btn-submit").onclick = function() { 
    const tooltip = document.getElementById("global-heatmap-tooltip");
    if (tooltip) tooltip.remove();
    closeModal("modal"); 
  };
  
  openModal("modal");
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

const openModal = (id) => document.getElementById(id).classList.add('active');
const closeModal = (id) => {
  document.getElementById("delete-button")?.remove();
  document.getElementById("move-up-button")?.remove();
  document.getElementById("modal-cancel").style.display = "";
  document.getElementById(id).classList.remove('active');
};

function showLoading() { document.getElementById("loading-overlay").classList.remove("hidden"); }
function hideLoading() { document.getElementById("loading-overlay").classList.add("hidden"); }

window.resetTimes = resetTimes;
window.openHelp = openHelp;
window.closeModal = closeModal;
window.createNewTask = createNewTask;
window.toggleTask = toggleTask;
window.moveTaskUp = moveTaskUp;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.createNewSubtask = createNewSubtask;
window.toggleSubtask = toggleSubtask;
window.addTimeScale = addTimeScale;
window.editTimeScale = editTimeScale;
window.deleteTimeScale = deleteTimeScale;
window.openModal = openModal;
window.openTimeScaleStatistics = openTimeScaleStatistics; 