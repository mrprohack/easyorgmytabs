# Tab Organizer Pro

A sleek and powerful Chrome Extension that automatically organizes your messy browser tabs into clean, color-coded Chrome Tab Groups.

## Features

*   **Group by Website**: Automatically collects all tabs from the same domain (e.g., all your YouTube or GitHub tabs) and collapses them into a single colored group.
*   **Group by Date**: Neatly sorts your tabs chronologically based on the last time you visited them (Today, This Week, Last Week, This Month, Older).
*   **Premium UI**: A beautifully designed popup interface using a clean glassmorphism aesthetic and smooth transitions.
*   **Safe & Reliable**: Built with Manifest V3. Safely handles multiple browser windows and respects pinned tabs so they are never accidentally grouped.

## Installation

Currently, this extension is available to install manually via Developer Mode in Chrome.

1.  Clone this repository or download the source code as a ZIP and extract it.
    ```bash
    git clone https://github.com/mrprohack/easyorgmytabs.git
    ```
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle switch in the top right corner.
4.  Click the **Load unpacked** button.
5.  Select the folder where you cloned or extracted the source code.
6.  The extension is now installed! Click the puzzle piece icon in your Chrome toolbar and pin **Tab Organizer Pro** for easy access.

## Usage

1.  Open the extension popup by clicking its icon in the toolbar.
2.  Click **Arrange by Date** to organize your current window's tabs chronologically.
3.  Click **Arrange by Website** to organize your current window's tabs by their domain names.

## Development

*   Install dev dependencies: 
pm install
*   Run the test suite: 
ode test.js (or 
pm test) — covers logic helpers, background handlers, the popup/dashboard DOM, and 300-tab load scenarios.
## Built With

*   HTML/CSS/JavaScript
*   Chrome Extensions API (Manifest V3)
*   [Inter Font](https://fonts.google.com/specimen/Inter) system fallbacks

## License

MIT License
