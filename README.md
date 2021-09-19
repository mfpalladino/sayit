# SayIt!

A primeira versão do projeto foi criada durante o SedexDay 2021 da Hi Platform.

O SayIt! pode ser utilizado para criação de vídeos estilo mosaíco em que pessoas se expressem sobre alguma causa.

Pode ser para enviar mensagens de final de ano a clientes, agradecer um colega por sua ajuda, lhe desejar sorte/melhora/sucesso, ou ainda para posicionamentos políticos, contra formas de injustiça, racismo e preconceito.

# Importante

Esta aplicação foi criada para utilização/validação de conceitos técnicos em um contexto de estudo e disseminação de conhecimento.

Qualquer mensagem passada utilizando o SayIt! **NÃO REFLETE EM NENHUMA HIPÓTESE O POSICIONAMENTO** da Hi Platform, seus colaboradores ou mesmo dos colaboradores deste repositório.

# O que foi utilizado aqui?

- [Serverless Framework](https://www.serverless.com/): Para definição da aplicação Serverless utilizando funções Lambda e eventos.
- [AWS Step functions](https://aws.amazon.com/pt/step-functions/): Para orquestração dos passos que fazem parte do processamento dos vídeos de entrada.
- [Amazon Transcribe](https://aws.amazon.com/pt/transcribe/): Para extração do texto e identificação do momento em que o texto foi falado no vídeo.
- [AWS S3](https://aws.amazon.com/pt/s3/): Armazenamento dos vídeos de entrada, cortados e mosaícos gerados.
- [AWS DynamoDB](https://aws.amazon.com/pt/dynamodb/): Tabelas de controle dos vídeos que devem ser publicados.
- [FFmpeg](https://www.ffmpeg.org/): Para tratamento e recorte dos vídeos de entrada e criação do mosaíco.
