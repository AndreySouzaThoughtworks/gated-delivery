import { connect } from "nats";

const nc = await connect({ servers: process.env.NATS_URL });

export async function publish(subject: string, payload: object) {
  nc.publish(subject, JSON.stringify(payload));
}
