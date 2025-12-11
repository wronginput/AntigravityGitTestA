# Pixel Physics Racer

A minimal, procedural, 1-bit physics-based endless runner built with JavaScript and Matter.js.

![Pixel Art Style](https://img.shields.io/badge/Style-1--Bit_Pixel-white?style=flat-square&logo=javascript)
![Physics](https://img.shields.io/badge/Physics-Matter.js-blue?style=flat-square)

## 🎮 Play

**[Click here to play locally]**  
Simply open `index.html` in any modern web browser. No build step required.

## ✨ Features

*   **Procedural Infinite Terrain**: The track generates endlessly as you drive, featuring rolling hills and challenging jumps.
*   **Physics Simulation**: Real-time 2D physics using `Matter.js`.
*   **Segmented Ground**: Terrain is constructed from chained physical segments for precise collision detection without "invisible roofs".
*   **Synthesized Audio**: Sound effects (engine hum, jump feedback) are generated in real-time using the Web Audio API. 
*   **1-Bit Aesthetic**: High-contrast, pixelated visual style rendered on an HTML5 Canvas.

## 🕹️ Controls

| Key | Action |
| :--- | :--- |
| **Space** | Jump |
| **Auto** | The ball accelerates automatically |

## 🛠️ Technical Details

This project demonstrates a "code-only" approach to game development:
*   **No Assets**: All graphics are drawn via canvas primitives. All sounds are synthesized.
*   **Dependencies**: Only requires `matter.js` (loaded via CDN).
*   **Cross-Platform**: Designed to be synced and developed across Windows and macOS via Git.

## 🚀 Development

Clone the repository:
```bash
git clone https://github.com/wronginput/AntigravityGitTestA.git
```

Make changes and open `index.html` to test.

## 📄 License

MIT License. Feel free to use this code for your own pixel physics experiments.
