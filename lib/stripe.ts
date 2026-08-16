import Stripe from "stripe"
import config from "./config"

export const stripeClient = config.stripe.secretKey ? new Stripe(config.stripe.secretKey, { apiVersion: "2025-08-27.basil" }) : null
