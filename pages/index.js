import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();

  const [showModal, setShowModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [showPlans, setShowPlans] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem("currentUser");
    if (storedUser) setCurrentUser(storedUser);
  }, []);

  const handleAuthSubmit = () => {
    const users = JSON.parse(localStorage.getItem("users") || "[]");

    if (authMode === "signup") {
      const exists = users.find((u) => u.email === email);
      if (exists) return alert("User already exists");
      users.push({ email, password });
      localStorage.setItem("users", JSON.stringify(users));
      localStorage.setItem("currentUser", email);
      setCurrentUser(email);
      setShowModal(false);
    } else {
      const found = users.find((u) => u.email === email && u.password === password);
      if (!found) return alert("Invalid credentials");
      localStorage.setItem("currentUser", email);
      setCurrentUser(email);
      setShowModal(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("currentUser");
    setCurrentUser(null);
  };

  const handleCreateClick = () => {
    router.push("/editor");
  };

  const plans = [
    { title: "Individual", price: "$20/mo", desc: "Base tools for solo creators" },
    { title: "Small Team", price: "$45/mo", desc: "For 3–5 team members" },
    { title: "Enterprise", price: "Contact Us", desc: "Custom pricing & integrations" }
  ];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.left}>
          <button onClick={() => setShowPlans(true)} style={styles.link}>📦 Plans</button>
        </div>
        <div style={styles.right}>
          {currentUser ? (
            <>
              <span>Welcome, {currentUser}</span>
              <button onClick={handleLogout} style={styles.link}>Log out</button>
            </>
          ) : (
            <>
              <button onClick={() => { setAuthMode("login"); setShowModal(true); }} style={styles.link}>Login</button>
              <button onClick={() => { setAuthMode("signup"); setShowModal(true); }} style={styles.link}>Sign up</button>
            </>
          )}
        </div>
      </header>

      <div style={styles.center}>
        <button onClick={handleCreateClick} style={styles.button}>🧠 Create a Website</button>
      </div>

      <footer style={styles.footer}>UCode Terminal Interface ⌘</footer>

      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <h2>{authMode === "login" ? "Log In" : "Sign Up"}</h2>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />
            <button onClick={handleAuthSubmit} style={styles.submitButton}>Submit</button>
            <button onClick={() => setShowModal(false)} style={styles.link}>Cancel</button>
          </div>
        </div>
      )}

      {showPlans && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, width: "90%", maxWidth: "800px" }}>
            <h2>Plans & Pricing</h2>
            <div style={{ display: "flex", justifyContent: "space-around", gap: "1rem", flexWrap: "wrap" }}>
              {plans.map((plan, i) => (
                <div key={i} style={{ border: "1px solid #0f0", padding: "1rem", width: "220px" }}>
                  <h3>{plan.title}</h3>
                  <p><strong>{plan.price}</strong></p>
                  <p>{plan.desc}</p>
                  <button
                    style={styles.submitButton}
                    onClick={() => {
                      localStorage.setItem("selectedPlan", plan.title);
                      setShowPlans(false);
                      router.push("/billing");
                    }}
                  >
                    Upgrade
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowPlans(false)} style={{ ...styles.submitButton, marginTop: "1rem" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: "#000",
    color: "#0f0",
    fontFamily: "Courier New, monospace",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    padding: "1rem",
    fontSize: "1rem"
  },
  left: {
    display: "flex",
    gap: "1rem"
  },
  right: {
    display: "flex",
    gap: "1rem"
  },
  center: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexGrow: 1
  },
  button: {
    backgroundColor: "#000",
    color: "#0f0",
    border: "1px solid #0f0",
    padding: "1rem 2rem",
    fontSize: "1.2rem",
    cursor: "pointer",
    fontFamily: "Courier New, monospace"
  },
  footer: {
    textAlign: "center",
    padding: "0.5rem",
    fontSize: "0.9rem"
  },
  link: {
    background: "none",
    border: "none",
    color: "#0f0",
    fontSize: "1rem",
    cursor: "pointer"
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000
  },
  modalBox: {
    backgroundColor: "#111",
    border: "1px solid #0f0",
    padding: "2rem",
    color: "#0f0",
    fontFamily: "Courier New, monospace",
    textAlign: "center"
  },
  input: {
    width: "100%",
    padding: "0.5rem",
    margin: "0.5rem 0",
    border: "1px solid #0f0",
    backgroundColor: "#000",
    color: "#0f0"
  },
  submitButton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: "#0f0",
    color: "#000",
    border: "none",
    marginTop: "0.5rem",
    cursor: "pointer"
  }
};