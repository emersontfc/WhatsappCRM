import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Onboarding() {
  const navigate = useNavigate();

  useEffect(() => {
    const alreadyRedirected = sessionStorage.getItem("onboarding_redirect");

    if (!alreadyRedirected) {
      sessionStorage.setItem("onboarding_redirect", "true");
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  return null;
}
