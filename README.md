# Time Manager

Time Manager is a single-page productivity app for balancing the work you want to do against the time you actually have available. It helps you define goals over multiple time scales, track real elapsed work, and visualize how much time is left to act on your priorities.

## What it does

The app is organized around three main views:

1. Tasks
   - Create, edit, delete, and reorder tasks.
   - Assign a target amount of work to each task for each time scale.
   - Start and stop timers directly from the task list.
   - Mark tasks as habits and keep progress streaks for recurring work.
   - Add subtasks with optional deadlines and study-day tracking.

2. Time scales
   - Define overlapping periods such as daily, weekly, or custom-duration cycles.
   - Set a scale start date and duration in days.
   - See combined progress across every task in that time window.
   - Track streaks, completion status, and whether the required work has been achieved.

3. Agenda
   - View a 15-minute calendar grid.
   - Drag across the agenda to mark busy periods such as sleep, work, or appointments.
   - Automatically subtract busy time from the amount of usable time remaining in each scale.
   - See task work plotted on the same schedule for a clearer picture of how time is being spent.
   - See at most one combined free-time limit per day, naming the scale goals that would become impossible without starting by that time.

## Additional features

- Audio notifications for milestone events and alerts.
- Real-time timer updates as work is being tracked.
- Detailed progress statistics and history for each time scale.
- "Give up" lockout flow to help discourage overwork after a reset event.
- Firebase authentication and real-time sync for account-backed data.
- Local migration tools for moving existing browser data into a Firebase account.

## Running the app

This project is a static front-end app. There is no package installation or build step.

1. Open the repository folder in a browser from a local web server, or run:

   ```bash
   cd /workspaces/TimeManager
   python3 -m http.server 8000
   ```

2. Visit `http://localhost:8000` in your browser.

Using a local server is recommended because the app loads JavaScript modules and browser assets from the project directory.

## Data storage

The app supports two storage modes:

- Local browser storage: data is saved in `localStorage` when no account is signed in.
- Firebase-backed storage: when signed in, the app syncs the current state to Firebase Realtime Database.

The UI also includes a migration action to copy local data to the active Firebase account.

## Project structure

- `index.html` — main page structure and modal shell.
- `style.css` — application styling.
- `script.js` — app state, rendering logic, task/time-scale behavior, agenda interactions, timer logic, and Firebase integration.
- `timerWorker.js` — background timer worker used to keep elapsed work tracking accurate.
- `ding.mp3` and `ring.mp3` — sound effects used for milestone and reminder notifications.
