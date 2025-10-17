import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import JSZip from "jszip";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function EditorPage() {
  const [files, setFiles] = useState({ "index.html": "<html><body><a href='page2.html'>Go</a></body></html>" });
  const [openTabs, setOpenTabs] = useState(["index.html"]);
  const [activeTab, setActiveTab] = useState("index.html");
  const [prompt, setPrompt] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [previewFile, setPreviewFile] = useState("index.html");
  const [loading, setLoading] = useState(false);

  const updateFileContent = (content) => {
    setFiles(prev => ({ ...prev, [activeTab]: content }));
  };

  const handleZipUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const zip = await JSZip.loadAsync(file);
    const loadedFiles = {};

    await Promise.all(
      Object.keys(zip.files).map(async (filename) => {
        const entry = zip.files[filename];
        if (!entry.dir && !filename.includes(".git") && !filename.includes("__MACOSX") && !filename.includes("node_modules")) {
          const content = await entry.async("string");
          loadedFiles[filename] = content;
        }
      })
    );

    setFiles(loadedFiles);
    const defaultFile = Object.keys(loadedFiles).find(f => f.endsWith(".html")) || Object.keys(loadedFiles)[0];
    setOpenTabs([defaultFile]);
    setActiveTab(defaultFile);
    setPreviewFile(defaultFile);
  };

  const handleGenerateOrImprove = async () => {
    if (!prompt) return;
    setLoading(true);
    const updatedHistory = [...chatHistory, { role: "user", content: prompt }];

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, code: files[activeTab], history: updatedHistory })
      });

      const data = await res.json();
      const response = data.message || "";
      const newFiles = {};

      const matches = response.matchAll(/####\s*(.+?)\.html\s*```html\s*([\s\S]*?)```/g);
      for (const match of matches) {
        const filename = match[1].trim() + ".html";
        const content = match[2].trim();
        newFiles[filename] = content;
      }

      if (Object.keys(newFiles).length > 0) {
        setFiles(prev => ({ ...prev, ...newFiles }));
        const newTabs = Object.keys(newFiles);
        setOpenTabs(prev => [...new Set([...prev, ...newTabs])]);
        setActiveTab(newTabs[0]);
        setPreviewFile(newTabs[0]);
      }

      setChatHistory(prev => [...prev, { role: "user", content: prompt }, { role: "assistant", content: response }]);
    } catch (err) {
      console.error("AI generation failed:", err);
    }

    setPrompt("");
    setLoading(false);
  };

  const buildTree = () => {
    const tree = {};
    Object.keys(files).forEach((path) => {
      const parts = path.split("/");
      let current = tree;
      parts.forEach((part, i) => {
        if (!current[part]) {
          current[part] = i === parts.length - 1 ? path : {};
        }
        current = current[part];
      });
    });
    return tree;
  };

  const FileTree = ({ node }) => (
    <ul style={{ paddingLeft: 16 }}>
      {Object.entries(node).map(([key, value]) =>
        typeof value === "string" ? (
          <li key={key} style={styles.fileItem} onClick={() => setActiveTab(value)}>{key}</li>
        ) : (
          <li key={key}>
            <details>
              <summary style={{ cursor: "pointer" }}>{key}</summary>
              <FileTree node={value} />
            </details>
          </li>
        )
      )}
    </ul>
  );

  const getFullHtml = (entryFile) => {
    let html = files[entryFile] || "";
    Object.entries(files).forEach(([filename, content]) => {
      if (filename.endsWith(".css")) {
        html = html.replace("</head>", `<style>${content}</style></head>`);
      }
      if (filename.endsWith(".js")) {
        html = html.replace("</body>", `<script>${content}</script></body>`);
      }
    });

    // Inject a click catcher for in-browser navigation
    html = html.replace("</body>", `
      <script>
        document.querySelectorAll('a[href$=".html"]').forEach(link => {
          link.addEventListener('click', function(e) {
            e.preventDefault();
            parent.postMessage({ type: 'navigate', path: this.getAttribute('href') }, '*');
          });
        });
      </script>
    </body>`);

    return html;
  };

  useEffect(() => {
    const handleMessage = (e) => {
      if (e.data.type === "navigate" && files[e.data.path]) {
        setPreviewFile(e.data.path);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [files]);

  return (
    <div style={styles.container}>
      <div style={styles.leftPane}>
        <h3>📁 Project Files</h3>
        <input type="file" accept=".zip" onChange={handleZipUpload} style={styles.upload} />
        <FileTree node={buildTree()} />
      </div>

      <div style={styles.centerPane}>
        <div style={styles.tabBar}>
          {openTabs.map(tab => (
            <div
              key={tab}
              style={{
                ...styles.tab,
                backgroundColor: tab === activeTab ? "#333" : "#111",
                color: tab === activeTab ? "#fff" : "#0f0"
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab.split("/").pop()}
            </div>
          ))}
        </div>

        <div style={styles.editorWrapper}>
          {activeTab && (
            <MonacoEditor
              height="300px"
              language={activeTab.endsWith(".js") ? "javascript" : activeTab.endsWith(".py") ? "python" : "html"}
              theme="vs-dark"
              value={files[activeTab]}
              onChange={updateFileContent}
            />
          )}

          <iframe
            title="Live Preview"
            srcDoc={getFullHtml(previewFile)}
            style={styles.previewIframe}
            sandbox="allow-scripts"
          />
        </div>
      </div>

      <div style={styles.rightPane}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask AI to generate or improve..."
          style={styles.promptInput}
        />
        <button
          onClick={handleGenerateOrImprove}
          disabled={loading}
          style={styles.submitButton}
        >
          {loading ? "Processing..." : "Submit to AI"}
        </button>
        <div style={styles.chatBox}>
          <h4>AI Assistant</h4>
          <div style={styles.chatLog}>
            {chatHistory.map((entry, idx) => (
              <div key={idx} style={{ marginBottom: "0.5rem" }}>
                <strong>{entry.role === "user" ? "You" : "AI"}:</strong>
                <pre style={{ whiteSpace: "pre-wrap" }}>{entry.content}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: "flex", height: "100vh", backgroundColor: "#000", color: "#0f0", fontFamily: "Courier New, monospace" },
  leftPane: { width: "20%", padding: "1rem", backgroundColor: "#111", overflowY: "auto", borderRight: "1px solid #0f0" },
  upload: { marginBottom: "1rem", width: "100%", backgroundColor: "#222", color: "#0f0", border: "1px solid #0f0", padding: "0.5rem" },
  fileItem: { cursor: "pointer", fontSize: "0.9rem", padding: "0.2rem 0" },
  centerPane: { width: "60%", display: "flex", flexDirection: "column" },
  tabBar: { display: "flex", gap: "0.5rem", padding: "0.5rem", backgroundColor: "#111" },
  tab: { padding: "0.5rem 1rem", border: "1px solid #0f0", cursor: "pointer" },
  editorWrapper: { flex: 1, display: "flex", flexDirection: "column", padding: "1rem" },
  previewIframe: { marginTop: "1rem", height: "300px", border: "1px solid #0f0", backgroundColor: "#fff" },
  rightPane: { width: "20%", backgroundColor: "#111", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto" },
  promptInput: { width: "100%", height: "150px", padding: "0.5rem", backgroundColor: "#000", color: "#0f0", border: "1px solid #0f0" },
  submitButton: { backgroundColor: "#0f0", color: "#000", border: "none", padding: "0.5rem", cursor: "pointer" },
  chatBox: { borderTop: "1px solid #0f0", paddingTop: "0.5rem" },
  chatLog: { maxHeight: "300px", overflowY: "auto", padding: "0.5rem", backgroundColor: "#000", border: "1px solid #0f0" }
};