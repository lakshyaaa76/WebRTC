import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // In a real production environment with Metered.ca, this endpoint would make 
  // a fetch request to Metered's API using a SECRET_API_KEY to generate a 
  // short-lived, ephemeral credential. For our static credentials in .env.local,
  // we simply serve them from the secure backend environment to the client.
  res.status(200).json({
    username: process.env.TURN_USERNAME || "REPLACE_WITH_OPEN_RELAY_USERNAME",
    credential: process.env.TURN_CREDENTIAL || "REPLACE_WITH_OPEN_RELAY_CREDENTIAL"
  });
}
