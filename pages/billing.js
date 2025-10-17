import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function BillingPage() {
  const [selectedPlan, setSelectedPlan] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const plan = localStorage.getItem("selectedPlan");
    if (!plan) {
      alert("No plan selected. Redirecting...");
      router.push("/");
    } else {
      setSelectedPlan(plan);
    }
  }, [router]);

  return (
    <div style={styles.container}>
      <h1>💳 UCode Billing Page</h1>
      <p>You're upgrading to the <strong>{selectedPlan}</strong> plan.</p>
      <p>🔧 Payment integration with Stripe or LemonSqueezy will go here.</p>
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: "#000",
    color: "#0f0",
    fontFamily: "Courier New, monospace",
    minHeight: "100vh",
    padding: "2rem"
  }
};