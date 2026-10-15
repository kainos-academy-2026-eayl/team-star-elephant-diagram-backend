import express, { type Express, type Request, type Response } from 'express'
import nunjucks from 'nunjucks'
import { join } from 'node:path'

export function createApp(): Express {
  const app = express()

  nunjucks.configure(join(import.meta.dirname, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
  })
  app.set('view engine', 'njk')

  app.get('/', (_req: Request, res: Response) => {
    res.render('index')
  })

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'UP', time: new Date().toISOString() })
  })

  return app
}
