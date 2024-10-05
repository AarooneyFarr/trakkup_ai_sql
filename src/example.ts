import openai from './openai.js'
import fs from 'fs'
import runSQL from './postgres.js'
import postgres, { Row, RowList } from 'postgres'

try {
	const schema = fs.readFileSync('./src/schema.sql', 'utf8')

	const SQLOnlyRequest =
		'Give me a postgres select statement that will answer the following question. Response should only contain sql syntax. No other commentary or corrections.'

	const strategies = [
		{
			name: 'zeroShot',
			prompt: schema + SQLOnlyRequest,
		},
		{
			name: 'Single domain few shot',
			prompt:
				schema + 'Who is from Utah? \n ' + "\n Select * from user where phone_number ilike '%801%';" + SQLOnlyRequest,
		},
	]

	const questions = [
		'What is the name of the user that worked the most trips that started in July 2023?',
		'Which company has the most users?',
		'Which inventory item has been scheduled the most?',
		'What is the name of the user that has the most roles?',
		'What is the name of the user that has worked the least?',
		'What is the name of the user that is from North Carolina?',
		// "I need insert sql into my tables can you provide good unique data?"
	]

	const results = []
	for (const strategy of strategies) {
		const strategyResults: {
			strategy: string
			question: string
			completionSQL: string
			sql: string
			queryRawResponse: any
			friendlyPrompt: string
			friendlyResponse: string
			error: string
		}[] = []
		for (const question of questions) {
			let error = 'none'
			let sanitizedSQL = ''
			let completionSQL = ''
			let dbResponse = null
			let friendlyRes = 'none'
			let friendlyPromp = 'none'

			try {
				completionSQL = (await promptGPT(strategy.prompt + ' ' + question)) ?? 'null response'

				sanitizedSQL = sanitizeForJustSql(completionSQL ?? '')

				dbResponse = await runSQL(sanitizedSQL)

				friendlyPromp =
					'I asked a question "' +
					question +
					'" and the response from the database was "' +
					JSON.stringify(dbResponse) +
					'" Please, just give a concise response in a more friendly way? Please do not give any other suggests or chatter.'

				friendlyRes = (await promptGPT(friendlyPromp)) ?? 'error'
			} catch (e: any) {
				error = e.message
			}

			strategyResults.push({
				strategy: strategy.name,
				question: question,
				completionSQL: completionSQL,
				sql: sanitizedSQL,
				queryRawResponse: dbResponse,
				friendlyPrompt: friendlyPromp,
				friendlyResponse: friendlyRes ?? 'no friendly response',
				error: error,
			})
		}

		results.push(strategyResults)
	}

	exportJsonToFile(results, './results.txt')
} catch (err: any) {
	console.error('Error reading file:', err.message)
}

const testString =
	"SELECT user_id, COUNT(trip_id) AS trip_count FROM public.trip_to_user_to_role WHERE assigned_at >= '2023-07-01' AND assigned_at < '2023-08-01' GROUP BY user_id ORDER BY trip_count DESC LIMIT 1;"

function sanitizeForJustSql(value: string) {
	const gptStartSqlMarker = '```sql'
	const gptEndSqlMarker = '```'
	if (value.includes(gptStartSqlMarker)) {
		value = value.split(gptStartSqlMarker)[1]
	}
	if (value.includes(gptEndSqlMarker)) {
		value = value.split(gptEndSqlMarker)[0]
	}

	const noBreaks = value.replace(/(\r\n|\n|\r)/gm, ' ')
	return noBreaks
}

async function promptGPT(prompt: string) {
	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: 'You are a helpful text-to-SQL assistant.' },
			{
				role: 'user',
				content: prompt,
			},
		],
	})

	return completion.choices[0].message.content
}

function exportJsonToFile(data: object, path: string) {
	// Convert the data to a JSON string
	const jsonString = JSON.stringify(data, null, 2) // Pretty-print with 2 spaces

	// Write the JSON string to the specified file
	fs.writeFile(path, jsonString, (err) => {
		if (err) {
			console.error('Error writing file:', err)
		} else {
			console.log('JSON data has been written to', path)
		}
	})
}
