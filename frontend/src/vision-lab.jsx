import React from "react";
import { createRoot } from "react-dom/client";
import { VisionLab } from "./crowd/VisionLab.jsx";
import "./style.css";
import "./crowd/crowd.css";

createRoot(document.getElementById("root")).render(<VisionLab />);
